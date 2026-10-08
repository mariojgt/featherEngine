/** Source reachability, including non-editor entry points. noUnusedLocals handles bindings. */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const sourceFile = /\.(?:[cm]?[jt]sx?)$/;
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = resolve(directory, entry.name);
  if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
  return entry.isDirectory() ? walk(path) : sourceFile.test(path) ? [path] : [];
});
export function auditSource(root) {
  const sources = walk(resolve(root, 'src'));
  const scripts = walk(resolve(root, 'scripts'));
  const files = new Set([...sources, ...scripts]);
  const config = ts.readConfigFile(resolve(root, 'tsconfig.app.json'), ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const edges = new Map();
  const entryPoints = new Set(scripts);

  // These are published SDK/staged entry points, not dead editor code. See docs/EXTENSIONS.md
  // and docs/PHYSICS_WORKER.md. Keep this list explicit so new orphan files cannot slip through.
  for (const path of ['src/extensions/index.ts', 'src/runtime/physicsWorkerClient.ts', 'src/runtime/physicsWorkerFlag.ts']) {
    entryPoints.add(resolve(root, path));
  }
  for (const path of sources) {
    if (/\.test\.[jt]sx?$/.test(path) || path.endsWith('.d.ts')) entryPoints.add(path);
  }
  for (const entry of readdirSync(root).filter(name => name.endsWith('.html'))) {
    const html = readFileSync(resolve(root, entry), 'utf8');
    for (const [, specifier] of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)) {
      entryPoints.add(resolve(root, specifier.replace(/^\//, '')));
    }
  }

  function resolveImport(specifier, importer) {
    if (specifier.startsWith('/src/')) specifier = relative(dirname(importer), resolve(root, specifier.slice(1)));
    else if (!specifier.startsWith('.')) return undefined;
    if (!specifier.startsWith('.')) specifier = `./${specifier}`;
    return ts.resolveModuleName(specifier, importer, options, ts.sys).resolvedModule?.resolvedFileName;
  }

  const escapeRegex = value => value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  function globDependencies(pattern, importer) {
    const absolute = resolve(dirname(importer), pattern);
    const matcher = new RegExp(`^${escapeRegex(absolute).replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`);
    return sources.filter(path => matcher.test(path));
  }

  for (const path of files) {
    const text = readFileSync(path, 'utf8');
    const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const dependencies = new Set();
    const add = specifier => {
      const dependency = resolveImport(specifier, path);
      if (dependency && files.has(dependency)) dependencies.add(dependency);
    };
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) add(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) add(node.arguments[0].text);
      // Vite workers use new URL('./worker.ts', import.meta.url).
      if (ts.isNewExpression(node) && node.expression.getText(ast) === 'URL' && node.arguments?.length && ts.isStringLiteral(node.arguments[0])) add(node.arguments[0].text);
      if (ts.isCallExpression(node) && /^import\.meta\.glob(?:Eager)?$/.test(node.expression.getText(ast))) {
        const patterns = ts.isArrayLiteralExpression(node.arguments[0]) ? node.arguments[0].elements : [node.arguments[0]];
        for (const pattern of patterns) if (pattern && ts.isStringLiteral(pattern)) {
          for (const dependency of globDependencies(pattern.text, path)) dependencies.add(dependency);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
    // Browser harnesses execute source imports inside CDP expressions, not Node imports.
    for (const [, specifier] of text.matchAll(/import\(\s*["'](\/src\/[^"']+)["']\s*\)/g)) add(specifier);
    edges.set(path, dependencies);
  }

  const reached = new Set();
  function visit(path) {
    if (reached.has(path)) return;
    reached.add(path);
    for (const dependency of edges.get(path) ?? []) visit(dependency);
  }
  for (const entryPoint of entryPoints) visit(entryPoint);
  const unused = sources.filter(path => !reached.has(path));
  return { unused: unused.map(path => relative(root, path)).sort(), files: sources.length, entryPoints: entryPoints.size };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = auditSource(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  if (report.unused.length) {
    console.error('Source files unreachable from editor/player/capture/tests/scripts/plugins/worker/SDK entry points:');
    for (const path of report.unused) console.error(`  ${path}`);
    process.exitCode = 1;
  } else {
    console.log(`Source audit passed: ${report.files} files checked against ${report.entryPoints} entry points.`);
  }
}
