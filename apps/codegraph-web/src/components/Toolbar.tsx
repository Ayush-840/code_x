'use client';

import { ReactNode } from 'react';

interface ToolbarProps {
  repoPath: string;
  setRepoPath: (path: string) => void;
  parsing: boolean;
  onParse: () => void;
  nodeCount: number;
  edgeCount: number;
}

export function Toolbar({ repoPath, setRepoPath, parsing, onParse, nodeCount, edgeCount }: ToolbarProps) {
  return (
    <div className="toolbar px-4 py-3 flex items-center gap-4">
      <h1 className="font-display text-xl font-bold text-yellow-500">CodeGraph</h1>
      
      <div className="flex-1 max-w-md">
        <input
          type="text"
          value={repoPath}
          onChange={(e) => setRepoPath(e.target.value)}
          placeholder="/path/to/python/repo"
          className="input"
          disabled={parsing}
        />
      </div>

      <button
        onClick={onParse}
        disabled={parsing || !repoPath.trim()}
        className="btn btn-primary"
      >
        {parsing ? 'Parsing...' : 'Parse Repo'}
      </button>

      {nodeCount > 0 && (
        <div className="flex items-center gap-4 text-sm text-gray-400 ml-auto">
          <span>{nodeCount} nodes</span>
          <span>{edgeCount} edges</span>
        </div>
      )}
    </div>
  );
}