/** Copy dictionaries for the sidebar file browser. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  actionLabel: '文件浏览器',
  browserTitle: '项目文件浏览器',
  loading: '加载中…',
  error: '无法读取目录。',
  retry: '重试',
  empty: '此文件夹为空。',
  truncated: '条目过多，仅显示开头部分。',
  file: '文件',
  directory: '文件夹',
  openFile: '预览文件',
  readLoading: '读取中…',
  readError: '无法读取文件内容。',
  readTruncated: '文件较大，仅预览开头部分。',
  bytes: '{{size}} 字节',
  close: '关闭',
  parent: '上级目录',
  home: '工作区根目录',
  refresh: '刷新',
  copyPath: '复制相对路径',
  copied: '已复制',
  pathLabel: '相对路径',
} satisfies Record<string, string>

/** File browser locale key union. */
export type FileBrowserLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  actionLabel: 'File browser',
  browserTitle: 'Project file browser',
  loading: 'Loading…',
  error: 'Unable to read the directory.',
  retry: 'Retry',
  empty: 'This folder is empty.',
  truncated: 'Too many entries; only the beginning is shown.',
  file: 'File',
  directory: 'Folder',
  openFile: 'Preview file',
  readLoading: 'Reading…',
  readError: 'Unable to read the file content.',
  readTruncated: 'The file is large; only the beginning is previewed.',
  bytes: '{{size}} bytes',
  close: 'Close',
  parent: 'Parent directory',
  home: 'Workspace root',
  refresh: 'Refresh',
  copyPath: 'Copy relative path',
  copied: 'Copied',
  pathLabel: 'Relative path',
} satisfies Record<FileBrowserLocaleKey, string>
