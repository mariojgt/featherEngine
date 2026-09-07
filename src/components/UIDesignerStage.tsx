import { useLayoutEffect, useRef, useState } from 'react';
import type { UIDocument } from '../types';
import { UIEditLayer } from '../ui/UIEditLayer';

const DEVICES = [
  { name: 'Desktop · 1280 × 720', width: 1280, height: 720 },
  { name: 'Full HD · 1920 × 1080', width: 1920, height: 1080 },
  { name: 'Tablet · 1024 × 768', width: 1024, height: 768 },
  { name: 'Phone · 390 × 844', width: 390, height: 844 },
  { name: 'Phone landscape · 844 × 390', width: 844, height: 390 },
];

/** Viewport size and zoom are preview settings; authored dimensions stay in logical pixels. */
export function UIDesignerStage({ doc }: { doc: UIDocument }) {
  const [device, setDevice] = useState(0);
  const [zoom, setZoom] = useState('fit');
  const [snap, setSnap] = useState(8);
  const [space, setSpace] = useState({ width: 1, height: 1 });
  const ref = useRef<HTMLDivElement>(null);
  const size = DEVICES[device];
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setSpace({ width: node.clientWidth, height: node.clientHeight }));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const fit = Math.max(0.05, Math.min((space.width - 40) / size.width, (space.height - 40) / size.height, 1));
  const scale = zoom === 'fit' ? fit : Number(zoom);
  return <div className="ui-designer-stage">
    <div className="ui-preview-controls">
      <select aria-label="Preview device" value={device} onChange={(event) => setDevice(Number(event.target.value))}>
        {DEVICES.map((item, i) => <option key={item.name} value={i}>{item.name}</option>)}
      </select>
      <select aria-label="Preview zoom" value={zoom} onChange={(event) => setZoom(event.target.value)}>
        <option value="fit">Fit · {Math.round(fit * 100)}%</option>
        {[0.25, 0.5, 0.75, 1, 1.5, 2].map((value) => <option value={value} key={value}>{value * 100}%</option>)}
      </select>
      <select aria-label="Snap grid" value={snap} onChange={(event) => setSnap(Number(event.target.value))}>
        <option value={1}>Snap off</option><option value={4}>Snap 4 px</option><option value={8}>Snap 8 px</option><option value={16}>Snap 16 px</option>
      </select>
    </div>
    <div className="ui-preview-scroll" ref={ref}>
      <div className="ui-artboard-space" style={{ width: size.width * scale, height: size.height * scale }}>
        <div className="ui-design-frame ui-device-artboard" style={{ width: size.width, height: size.height, transform: `scale(${scale})` }}>
          <UIEditLayer doc={doc} fillParent={doc.surface === 'screen'} snap={snap} />
        </div>
      </div>
    </div>
    <div className="ui-preview-hint">{doc.name} · {size.width} × {size.height} · Drag to move · Alt bypasses snapping</div>
  </div>;
}
