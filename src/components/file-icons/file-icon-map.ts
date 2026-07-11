// File-extension-to-icon dispatch — mirrors Crunch's getFileIconByExtension.
import { FileText } from 'lucide-react';
import {
  TypeScriptIcon,
  JavaScriptIcon,
  PythonIcon,
  GoIcon,
  RustIcon,
  ReactIcon,
  VueIcon,
  SvelteIcon,
  AstroIcon,
  SwiftIcon,
  KotlinIcon,
  RubyIcon,
  PHPIcon,
  JavaIcon,
  CIcon,
  CppIcon,
  CSharpIcon,
  CSSIcon,
  HTMLIcon,
  SCSSIcon,
  JSONIcon,
  YAMLIcon,
  ShellIcon,
  SQLIcon,
  GraphQLIcon,
  PrismaIcon,
  DockerIcon,
  TOMLIcon,
  MarkdownIcon,
  MarkdownInfoIcon,
  CSVIcon,
  SQLiteIcon,
  ParquetIcon,
  ArrowDataIcon,
  ExcelIcon,
  PDFIcon,
  ImageFileIcon,
  SVGIcon,
  TxtIcon,
  WordIcon,
  PowerPointIcon,
  NpmIcon,
  GitIcon,
  LockFileIcon,
  LicenseIcon,
} from './framework-icons';

export function getFileIconByExtension(
  filename: string,
  returnNullForUnknown = false,
): React.ComponentType<{ className?: string }> | null {
  const filenameLower = filename.toLowerCase();
  const baseFilename = filenameLower.split('/').pop() || filenameLower;

  // Dockerfile
  if (filenameLower === 'dockerfile' || filenameLower.endsWith('/dockerfile')) {
    return DockerIcon;
  }

  // Git files
  if (
    baseFilename === '.gitignore' ||
    baseFilename === '.gitattributes' ||
    baseFilename === '.gitmodules' ||
    baseFilename === '.gitkeep'
  ) {
    return GitIcon;
  }

  // .npmrc
  if (baseFilename === '.npmrc') {
    return NpmIcon;
  }

  // .prettierrc
  if (baseFilename === '.prettierrc') {
    return JSONIcon;
  }

  // LICENSE / COPYING
  if (
    baseFilename === 'license' ||
    baseFilename === 'license.md' ||
    baseFilename === 'license.txt' ||
    baseFilename === 'copying' ||
    baseFilename === 'copying.md' ||
    baseFilename === 'copying.txt'
  ) {
    return LicenseIcon;
  }

  // Lock files
  if (
    baseFilename === 'package-lock.json' ||
    baseFilename === 'yarn.lock' ||
    baseFilename === 'pnpm-lock.yaml' ||
    baseFilename === 'bun.lockb' ||
    baseFilename === 'composer.lock' ||
    baseFilename === 'gemfile.lock' ||
    baseFilename === 'cargo.lock' ||
    baseFilename === 'poetry.lock' ||
    baseFilename === 'pipfile.lock' ||
    baseFilename.endsWith('.lock')
  ) {
    return LockFileIcon;
  }

  // .env files
  if (baseFilename === '.env') {
    return TOMLIcon;
  }
  if (baseFilename.startsWith('.env.')) {
    return ShellIcon;
  }

  // Markdown — README gets info icon
  if (filenameLower.endsWith('.md') || filenameLower.endsWith('.mdx')) {
    const nameWithoutExt = baseFilename.replace(/\.(md|mdx)$/, '');
    if (nameWithoutExt === 'readme') {
      return MarkdownInfoIcon;
    }
    return MarkdownIcon;
  }

  // JavaScript files
  if (
    filenameLower.endsWith('.js') ||
    filenameLower.endsWith('.mjs') ||
    filenameLower.endsWith('.cjs')
  ) {
    return JavaScriptIcon;
  }

  const ext = filename.split('.').pop()?.toLowerCase() || '';

  switch (ext) {
    case 'tsx':
      return ReactIcon;
    case 'ts':
      return TypeScriptIcon;
    case 'js':
    case 'mjs':
    case 'cjs':
      return JavaScriptIcon;
    case 'jsx':
      return ReactIcon;
    case 'py':
    case 'pyw':
    case 'pyi':
      return PythonIcon;
    case 'go':
      return GoIcon;
    case 'rs':
      return RustIcon;
    case 'css':
      return CSSIcon;
    case 'html':
    case 'htm':
      return HTMLIcon;
    case 'scss':
    case 'sass':
      return SCSSIcon;
    case 'json':
    case 'jsonc':
      return JSONIcon;
    case 'yaml':
    case 'yml':
      return YAMLIcon;
    case 'sh':
    case 'bash':
    case 'zsh':
      return ShellIcon;
    case 'sql':
      return SQLIcon;
    case 'graphql':
    case 'gql':
      return GraphQLIcon;
    case 'prisma':
      return PrismaIcon;
    case 'dockerfile':
      return DockerIcon;
    case 'toml':
      return TOMLIcon;
    case 'env':
      return TOMLIcon;
    case 'java':
      return JavaIcon;
    case 'c':
    case 'h':
      return CIcon;
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'hpp':
      return CppIcon;
    case 'cs':
      return CSharpIcon;
    case 'php':
      return PHPIcon;
    case 'rb':
      return RubyIcon;
    case 'kt':
      return KotlinIcon;
    case 'vue':
      return VueIcon;
    case 'svelte':
      return SvelteIcon;
    case 'astro':
      return AstroIcon;
    case 'swift':
      return SwiftIcon;
    // Data files
    case 'csv':
    case 'tsv':
      return CSVIcon;
    case 'db':
    case 'sqlite':
    case 'sqlite3':
      return SQLiteIcon;
    case 'parquet':
    case 'pq':
      return ParquetIcon;
    case 'xlsx':
    case 'xls':
      return ExcelIcon;
    case 'arrow':
    case 'feather':
    case 'ipc':
      return ArrowDataIcon;
    // Documents
    case 'pdf':
      return PDFIcon;
    case 'doc':
    case 'docx':
      return WordIcon;
    case 'ppt':
    case 'pptx':
      return PowerPointIcon;
    // Images
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'ico':
    case 'bmp':
      return ImageFileIcon;
    case 'svg':
      return SVGIcon;
    case 'txt':
      return TxtIcon;
    default:
      return returnNullForUnknown ? null : FileText;
  }
}

// ── Widget additions (not in the jarvis/Crunch original) ────────────────────

/**
 * Map a fenced-code language tag (```python, ```tsx …) to the same brand
 * icons, by translating the tag to a representative file extension and
 * reusing the dispatch above. Unknown tags fall back to the generic file icon.
 */
const LANGUAGE_TO_EXT: Record<string, string> = {
  javascript: 'js', js: 'js', jsx: 'jsx',
  typescript: 'ts', ts: 'ts', tsx: 'tsx',
  python: 'py', py: 'py',
  go: 'go', golang: 'go',
  rust: 'rs', rs: 'rs',
  ruby: 'rb', rb: 'rb',
  java: 'java', kotlin: 'kt', kt: 'kt',
  c: 'c', cpp: 'cpp', 'c++': 'cpp', csharp: 'cs', 'c#': 'cs', cs: 'cs',
  php: 'php', swift: 'swift',
  html: 'html', xml: 'html', svg: 'svg',
  css: 'css', scss: 'scss', sass: 'scss', less: 'css',
  json: 'json', jsonc: 'json', json5: 'json',
  yaml: 'yaml', yml: 'yaml', toml: 'toml',
  bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh', console: 'sh', powershell: 'sh',
  sql: 'sql', postgres: 'sql', mysql: 'sql', sqlite: 'sql',
  graphql: 'graphql', gql: 'graphql', prisma: 'prisma',
  dockerfile: 'dockerfile', docker: 'dockerfile',
  markdown: 'md', md: 'md', mdx: 'md', text: 'txt', txt: 'txt',
  vue: 'vue', svelte: 'svelte', astro: 'astro',
};

export function getFileIconByLanguage(
  language: string,
): React.ComponentType<{ className?: string }> {
  const ext = LANGUAGE_TO_EXT[language.toLowerCase().trim()];
  return (ext ? getFileIconByExtension(`x.${ext}`, true) : null) ?? FileText;
}
