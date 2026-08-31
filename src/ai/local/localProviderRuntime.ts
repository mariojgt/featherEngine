// Keep the large provider behind one application-owned lazy boundary. In development this also
// prevents a late bare-package import from being mistaken for a model-download failure.
export { transformersJS } from '@browser-ai/transformers-js';
