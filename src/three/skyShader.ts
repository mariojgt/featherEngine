export const skyVertexShader = `
varying vec3 vDirection;

void main() {
  vDirection = normalize(position);
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const skyFragmentShader = `
uniform vec3 topColor;
uniform vec3 horizonColor;
uniform vec3 groundColor;
uniform vec3 sunColor;
uniform vec3 sunDirection;
uniform float sunIntensity;
uniform float cloudCoverage;
uniform vec2 cloudOffset;
uniform float lightningFlash;
varying vec3 vDirection;

float cloudHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float cloudNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(cloudHash(i), cloudHash(i+vec2(1,0)), f.x), mix(cloudHash(i+vec2(0,1)), cloudHash(i+vec2(1,1)), f.x), f.y);
}
float cloudFbm(vec2 p) {
  float n=0.0, a=0.55;
  for(int i=0;i<5;i++) { n += cloudNoise(p)*a; p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(12.3,4.7); a*=0.5; }
  return n;
}

void main() {
  float height = clamp(vDirection.y * 0.5 + 0.5, 0.0, 1.0);
  float upper = smoothstep(0.44, 1.0, height);
  float lower = smoothstep(0.0, 0.46, height);
  vec3 lowerSky = mix(groundColor, horizonColor, lower);
  vec3 upperSky = mix(horizonColor, topColor, upper);
  vec3 color = mix(lowerSky, upperSky, smoothstep(0.45, 0.55, height));

  float sunDisc = pow(max(dot(normalize(vDirection), normalize(sunDirection)), 0.0), 720.0);
  float sunGlow = pow(max(dot(normalize(vDirection), normalize(sunDirection)), 0.0), 18.0);
  color += sunColor * (sunDisc * 1.8 + sunGlow * 0.2) * sunIntensity;

  if (cloudCoverage > 0.001 && vDirection.y > 0.0) {
    // Soften perspective toward the horizon: a hard denominator clamp creates a visible ceiling seam.
    vec2 p = vDirection.xz / (vDirection.y + 0.35) * 1.7 + cloudOffset;
    float broad = cloudFbm(p * 0.55);
    float detail = cloudFbm(p * 2.5 + broad * 2.0);
    float mass = broad * 0.76 + detail * 0.24;
    float mask = smoothstep(1.0-cloudCoverage, 1.23-cloudCoverage, mass);
    float edge = max(0.0, cloudFbm(p*0.55+vec2(0.12,-0.08)) - broad);
    vec3 storm = mix(topColor * 0.22, horizonColor * 0.52, clamp(detail*0.75 + edge*4.0, 0.0, 1.0));
    storm += sunColor * edge * 0.7 * sunIntensity;
    color = mix(color, storm, mask * smoothstep(0.015, 0.35, vDirection.y));
  }
  color += vec3(0.43, 0.58, 0.82) * lightningFlash;

  gl_FragColor = vec4(color, 1.0);
}
`;
