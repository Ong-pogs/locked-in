#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(SCRIPT_DIR, '..');
const SOURCE_ROOTS = ['app', 'components', 'hooks', 'lib', 'services', 'stores'];

const PROHIBITED_CLAIMS = [
  { label: 'guaranteed', pattern: /\bguaranteed\b/i },
  { label: 'risk free', pattern: /\brisk[ -]free\b/i },
  { label: 'every cent back', pattern: /\bevery\s+cent\s+back\b/i },
  { label: 'learn-to-earn', pattern: /\blearn[ -]to[ -]earn\b/i },
];

function literalText(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isJsxText(node)) return node.getText();
  if (
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  ) {
    return node.text;
  }
  return null;
}

export function findProhibitedPublicClaims(source, filename = 'input.tsx') {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    extname(filename) === '.ts' ? ts.ScriptKind.TS : ts.ScriptKind.TSX,
  );
  const findings = [];

  function visit(node) {
    const text = literalText(node);
    if (text != null) {
      for (const claim of PROHIBITED_CLAIMS) {
        if (!claim.pattern.test(text)) continue;
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        findings.push({
          file: filename,
          line: position.line + 1,
          claim: claim.label,
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await sourceFiles(path));
      continue;
    }
    if (entry.isFile() && ['.ts', '.tsx'].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

export async function scanPublicSource() {
  const findings = [];
  for (const root of SOURCE_ROOTS) {
    const files = await sourceFiles(join(WEB_ROOT, root));
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      findings.push(
        ...findProhibitedPublicClaims(source, relative(WEB_ROOT, file).replaceAll('\\', '/')),
      );
    }
  }
  return findings;
}

function isInvokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    // Resolve symlinks before comparing so aliased entrypoints still run.
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]));
  } catch {
    // A missing invocation path is not a direct entrypoint.
    return false;
  }
}

const invokedDirectly = isInvokedDirectly();

if (invokedDirectly) {
  const findings = await scanPublicSource();
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`${finding.file}:${finding.line} contains prohibited public copy: ${finding.claim}`);
    }
    process.exitCode = 1;
  } else {
    console.log('Public copy policy passed.');
  }
}
