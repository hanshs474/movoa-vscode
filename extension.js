'use strict';
const vscode = require('vscode');
const path = require('path');
const { generateVideo, credits, uploadImage, MovoaError, BASE, MODELS, DEFAULT_MODEL } = require('./client');

const SECRET = 'movoa.apiKey';
const UTM = 'utm_source=vscode&utm_medium=extension';

async function apiKey(context) {
  return (await context.secrets.get(SECRET)) || process.env.MOVOA_API_KEY || '';
}

function setting(name) {
  return vscode.workspace.getConfiguration('movoa').get(name);
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'clip';
}

async function saveInto(folderUri, name, url) {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const ext = (new URL(url).pathname.match(/\.(mp4|webm|mov)$/i) || [, 'mp4'])[1];
  const target = vscode.Uri.joinPath(folderUri, `${name}.${ext}`);
  await vscode.workspace.fs.writeFile(target, bytes);
  return target;
}

function outputFolder() {
  const ws = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!ws) return undefined;
  return vscode.Uri.joinPath(ws.uri, setting('outputFolder') || 'assets');
}

function withProgress(task) {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Movoa', cancellable: true },
    async (progress, token) => {
      const ctrl = new AbortController();
      token.onCancellationRequested(() => ctrl.abort());
      progress.report({ message: 'submitting…' });
      return task(ctrl.signal, (m) => progress.report({ message: m }));
    }
  );
}

function open(p) {
  vscode.env.openExternal(vscode.Uri.parse(`${BASE}${p}${p.includes('?') ? '&' : '?'}${UTM}`));
}

function reportError(err) {
  const kind = err instanceof MovoaError ? err.kind : 'other';
  const actions = kind === 'auth' ? ['Set API Key', 'Get a Key'] : kind === 'quota' || kind === 'plan' ? ['See Pricing'] : [];
  vscode.window.showErrorMessage(`Movoa: ${err.message || err}`, ...actions).then((a) => {
    if (a === 'Set API Key') vscode.commands.executeCommand('movoa.setApiKey');
    if (a === 'Get a Key') open('/settings/apikeys');
    if (a === 'See Pricing') open('/pricing');
  });
}

async function insertIfMarkdown(editor, file) {
  if (!editor || !['markdown', 'mdx'].includes(editor.document.languageId)) return;
  const rel = path.relative(path.dirname(editor.document.uri.fsPath), file.fsPath).split(path.sep).join('/');
  await editor.insertSnippet(new vscode.SnippetString(`<video src="${rel.replace(/\$/g, '\\$')}" controls></video>`));
}

async function generate(context, sourceUri) {
  const animate = sourceUri !== undefined;
  let source = sourceUri && sourceUri.fsPath ? sourceUri : undefined;
  if (animate && !source) {
    source = ((await vscode.window.showOpenDialog({ canSelectMany: false, filters: { Images: ['png', 'jpg', 'jpeg', 'webp'] } })) || [])[0];
    if (!source) return;
  }
  const prompt = await vscode.window.showInputBox({
    title: source ? `Movoa: Animate ${path.basename(source.fsPath)}` : 'Movoa: Generate Video',
    prompt: source
      ? 'Describe the motion: what moves, how the camera moves, and what we hear'
      : 'Describe the shot: who or what moves, where, how the camera moves, and what we hear',
    placeHolder: 'a paper lantern drifting over a night river, low angle, slow push-in, water lapping softly',
  });
  if (!prompt) return;
  const model = setting('model') || DEFAULT_MODEL;
  let ratio;
  if (!source) {
    ratio = await vscode.window.showQuickPick((MODELS[model] || MODELS[DEFAULT_MODEL]).ratios, { title: 'Aspect ratio' });
    if (!ratio) return;
  }
  const folder = source ? vscode.Uri.file(path.dirname(source.fsPath)) : outputFolder();
  if (!folder) return vscode.window.showErrorMessage('Open a folder first: Movoa saves the clip into your workspace.');
  const editor = vscode.window.activeTextEditor;
  try {
    const key = await apiKey(context);
    const file = await withProgress(async (signal, say) => {
      let imageUrl;
      if (source) {
        say('uploading the first frame…');
        imageUrl = await uploadImage(await vscode.workspace.fs.readFile(source), path.basename(source.fsPath), { signal });
      }
      const url = await generateVideo(prompt, {
        model, duration: setting('duration'), resolution: setting('resolution'), ratio, imageUrl,
        apiKey: key, signal,
        onQueued: () => say('rendering, a clip with sound takes a few minutes…'),
        onWaiting: (t) => { if (t.queued && t.queueEta) say(`in line, about ${Math.ceil(t.queueEta / 60)} min…`); },
      });
      say('saving…');
      const base = source ? path.basename(source.fsPath).replace(/\.[^.]+$/, '') + '-movoa' : `movoa-${slug(prompt)}`;
      return saveInto(folder, `${base}-${Date.now().toString(36)}`, url);
    });
    await insertIfMarkdown(editor, file);
    const pick = await vscode.window.showInformationMessage(`Saved ${vscode.workspace.asRelativePath(file)}`, 'Open');
    if (pick) vscode.commands.executeCommand('vscode.open', file);
  } catch (err) {
    reportError(err);
  }
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('movoa.generateVideo', () => generate(context)),
    vscode.commands.registerCommand('movoa.animateImage', (uri) => generate(context, uri || null)),
    vscode.commands.registerCommand('movoa.showCredits', async () => {
      try {
        const n = await credits({ apiKey: await apiKey(context) });
        const a = await vscode.window.showInformationMessage(`Movoa: ${n} credits left on this account.`, 'See Pricing');
        if (a) open('/pricing');
      } catch (err) {
        reportError(err);
      }
    }),
    vscode.commands.registerCommand('movoa.setApiKey', async () => {
      const value = await vscode.window.showInputBox({
        title: 'Movoa API key',
        prompt: 'From movoa.ai/settings/apikeys. Stored in VS Code secret storage. Leave empty to remove.',
        password: true,
        ignoreFocusOut: true,
      });
      if (value === undefined) return;
      if (value.trim()) await context.secrets.store(SECRET, value.trim());
      else await context.secrets.delete(SECRET);
      vscode.window.showInformationMessage(value.trim() ? 'Movoa API key saved.' : 'Movoa API key removed.');
    })
  );
}

module.exports = { activate, deactivate() {} };
