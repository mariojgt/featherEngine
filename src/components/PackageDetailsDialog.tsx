import { PACKAGE_SEMVER } from '../project/packageValidation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Camera, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { usePackageDetailsStore } from '../store/packageDetailsStore';
import { captureViewportImage } from '../runtime/viewportCaptureBridge';
import { dataUrlByteLength, makeCoverImage } from '../utils/coverImage';
import { formatSize } from '../marketplace/catalog';

/**
 * Collects the metadata a package carries into the store: name, description, author, version, tags
 * and cover art. Mounted once in App, portalled to <body>. Escape cancels.
 *
 * Cover art can come from an image file or straight from the viewport, which is usually the better
 * shot for a template — it is literally the world being shared.
 */
export function PackageDetailsDialog() {
  const request = usePackageDetailsStore((state) => state.request);
  const respond = usePackageDetailsStore((state) => state.respond);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [author, setAuthor] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [tags, setTags] = useState('');
  const [thumbnail, setThumbnail] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState<'file' | 'viewport' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(request);
  requestRef.current = request;

  // Reset to this request's defaults whenever a new one opens.
  useEffect(() => {
    if (!request) return;
    const d = request.defaults;
    setName(d.name ?? '');
    setDescription(d.description ?? '');
    setAuthor(d.author ?? '');
    setVersion(d.version ?? '1.0.0');
    setTags((d.tags ?? []).join(', '));
    setThumbnail(d.thumbnail);
    setBusy(null);
    setError(null);
    const frame = window.requestAnimationFrame(() => nameRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        respond(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, respond]);

  const coverBytes = useMemo(() => (thumbnail ? dataUrlByteLength(thumbnail) : 0), [thumbnail]);

  if (!request) return null;

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy('file');
    setError(null);
    try {
      const cover = await makeCoverImage(file);
      if (requestRef.current === request) setThumbnail(cover);
    } catch (caught) {
      if (requestRef.current === request) setError(caught instanceof Error ? caught.message : 'Could not read that image.');
    } finally {
      if (requestRef.current === request) setBusy(null);
    }
  };

  const useViewport = async () => {
    setBusy('viewport');
    setError(null);
    try {
      const shot = await captureViewportImage();
      if (!shot) throw new Error('The 3D viewport is not open, so there is nothing to capture.');
      const cover = await makeCoverImage(shot);
      if (requestRef.current === request) setThumbnail(cover);
    } catch (caught) {
      if (requestRef.current === request) setError(caught instanceof Error ? caught.message : 'Could not capture the viewport.');
    } finally {
      if (requestRef.current === request) setBusy(null);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || busy) return;
    if (!PACKAGE_SEMVER.test(version.trim() || '1.0.0')) { setError('Use a version such as 1.0.0 or 1.0.0-beta.1.'); return; }
    respond({
      name: name.trim(),
      description: description.trim() || undefined,
      author: author.trim() || undefined,
      version: version.trim() || '1.0.0',
      // Split on commas, drop blanks and duplicates, lowercase so the store's tag filter groups them.
      tags: [...new Set(tags.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean))],
      thumbnail,
    });
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="dialog-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onMouseDown={(event) => event.target === event.currentTarget && respond(null)}
      >
        <motion.form
          className="dialog package-details"
          role="dialog"
          aria-modal="true"
          aria-labelledby="package-details-title"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          onSubmit={submit}
        >
          <header className="dialog-head">
            <h2 id="package-details-title">{request.title}</h2>
            {request.summary && <p>{request.summary}</p>}
          </header>

          <div className="package-details-body">
            <div className="package-details-cover">
              {thumbnail ? (
                <img src={thumbnail} alt="Package cover preview" />
              ) : (
                <span className="package-details-cover-empty">
                  <ImagePlus size={22} aria-hidden />
                  No cover
                </span>
              )}
              <div className="package-details-cover-actions">
                <button type="button" onClick={() => fileRef.current?.click()} disabled={!!busy}>
                  {busy === 'file' ? <Loader2 size={13} className="spin" aria-hidden /> : <ImagePlus size={13} aria-hidden />}
                  Choose image
                </button>
                {request.allowViewportCover !== false && (
                  <button type="button" onClick={() => void useViewport()} disabled={!!busy}>
                    {busy === 'viewport' ? <Loader2 size={13} className="spin" aria-hidden /> : <Camera size={13} aria-hidden />}
                    Use viewport
                  </button>
                )}
                {thumbnail && (
                  <button type="button" onClick={() => setThumbnail(undefined)} disabled={!!busy}>
                    <Trash2 size={13} aria-hidden />
                    Remove
                  </button>
                )}
              </div>
              {coverBytes > 0 && <span className="field-hint">Cover · {formatSize(coverBytes)}</span>}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(event) => {
                  void pickFile(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </div>

            <div className="package-details-fields">
              <label className="node-field">
                <span>Name</span>
                <input ref={nameRef} value={name} onChange={(event) => setName(event.target.value)} required />
              </label>
              <label className="node-field">
                <span>Description</span>
                <textarea
                  value={description}
                  rows={3}
                  placeholder="What is in it, and what someone would use it for."
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <div className="package-details-row">
                <label className="node-field">
                  <span>Author</span>
                  <input value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="Your name" />
                </label>
                <label className="node-field">
                  <span>Version</span>
                  <input value={version} onChange={(event) => setVersion(event.target.value)} placeholder="1.0.0" />
                </label>
              </div>
              <label className="node-field">
                <span>Tags</span>
                <input
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                  placeholder="props, sci-fi, physics"
                />
              </label>
              <p className="field-hint">Comma separated. Tags drive the store's filter row.</p>
            </div>
          </div>

          {error && <p className="package-details-error">{error}</p>}

          <footer className="dialog-actions">
            <button type="button" onClick={() => respond(null)}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={!name.trim() || !!busy}>
              Export
            </button>
          </footer>
        </motion.form>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
