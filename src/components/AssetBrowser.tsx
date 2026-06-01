import { Box, Image, Music, Search, Upload, X } from 'lucide-react';
import clsx from 'clsx';
import { useRef, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import type { AssetItem } from '../types';

const formatBytes = (bytes: number) => {
  if (!bytes) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

function AssetPreview({ asset }: { asset: AssetItem }) {
  if (asset.type === 'image' && asset.url) {
    return <img src={asset.url} alt="" />;
  }

  const Icon = asset.type === 'audio' ? Music : Box;
  return (
    <div className={clsx('asset-icon-preview', asset.type)}>
      <Icon size={24} aria-hidden />
    </div>
  );
}

export function AssetBrowser() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const assets = useEditorStore((state) => state.assets);
  const assetSearch = useEditorStore((state) => state.assetSearch);
  const addAssets = useEditorStore((state) => state.addAssets);
  const setAssetSearch = useEditorStore((state) => state.setAssetSearch);
  const removeAsset = useEditorStore((state) => state.removeAsset);

  const filteredAssets = assets.filter((asset) => asset.name.toLowerCase().includes(assetSearch.toLowerCase()));

  return (
    <section
      className={clsx('panel asset-panel', dragging && 'dragging')}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        addAssets(event.dataTransfer.files);
      }}
    >
      <div className="panel-header">
        <div>
          <span className="eyebrow">Project</span>
          <h2>Assets</h2>
        </div>
        <button className="icon-button compact" title="Upload assets" onClick={() => inputRef.current?.click()}>
          <Upload size={15} aria-hidden />
        </button>
        <input
          ref={inputRef}
          type="file"
          hidden
          multiple
          accept=".glb,.gltf,.png,.jpg,.jpeg,.mp3,.wav"
          onChange={(event) => event.target.files && addAssets(event.target.files)}
        />
      </div>

      <label className="search-field">
        <Search size={15} aria-hidden />
        <input value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} placeholder="Search assets" />
      </label>

      <div className="asset-grid">
        {filteredAssets.map((asset) => (
          <article key={asset.id} className="asset-tile">
            <AssetPreview asset={asset} />
            <div className="asset-meta">
              <strong title={asset.name}>{asset.name}</strong>
              <span>
                {asset.type} / {formatBytes(asset.size)}
              </span>
            </div>
            <button className="asset-remove" title="Remove asset" onClick={() => removeAsset(asset.id)}>
              <X size={14} aria-hidden />
            </button>
          </article>
        ))}
        {filteredAssets.length === 0 && (
          <div className="empty-state wide">
            <Image size={20} aria-hidden />
            <span>No assets imported</span>
          </div>
        )}
      </div>
    </section>
  );
}
