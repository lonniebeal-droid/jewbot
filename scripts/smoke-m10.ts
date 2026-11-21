/**
 * M10 ghost-text smoke. Mocked Ollama. No live model.
 */
import { createCompletionController } from '../src/modules/editor';
import { DEFAULT_COMPLETE_MODEL, generateFim } from '../src/modules/llm';

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function expectThrow(fn: () => Promise<unknown>, re: RegExp, msg: string) {
  try {
    await fn();
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    expect(re.test(text), `${msg} (got: ${text})`);
    return;
  }
  throw new Error(`${msg} (did not throw)`);
}

function testDebounceAcceptDismiss() {
  const calls: string[] = [];
  let pending: (() => void) | null = null;
  const ctrl = createCompletionController({
    debounceMs: 250,
    schedule(fn) {
      pending = fn;
      return { cancel() { if (pending === fn) pending = null; } };
    },
    request(prefix, suffix) {
      calls.push(`${prefix}|${suffix}`);
      return Promise.resolve('world');
    },
  });
  ctrl.schedule('hello ', '');
  expect(calls.length === 0 && ctrl.state().ghost === '', 'debounce holds the request');
  ctrl.cancel();
  pending?.();
  expect(calls.length === 0, 'cancel drops the scheduled request');
  ctrl.schedule('hello ', '\n');
  const fire = pending;
  pending = null;
  fire?.();
  return Promise.resolve().then(() => {
    expect(calls.join() === 'hello |\n', `request ${calls.join()}`);
    expect(ctrl.state().ghost === 'world', 'ghost text is shown');
    expect(ctrl.accept() === 'world', 'tab accepts the ghost');
    expect(ctrl.state().ghost === '', 'accept clears the ghost');
    ctrl.schedule('a', 'b');
    fire?.();
  }).then(() => {
    ctrl.dismiss();
    expect(ctrl.state().ghost === '', 'esc dismisses');
  });
}

function testUnhealthyDisables() {
  let ran = false;
  const ctrl = createCompletionController({
    schedule(fn) {
      fn();
      return { cancel() {} };
    },
    request() {
      ran = true;
      return Promise.resolve(null);
    },
  });
  ctrl.schedule('x', 'y');
  return Promise.resolve().then(() => {
    expect(ran, 'request ran');
    expect(ctrl.state().enabled === false, 'no healthy host disables completion');
    expect(ctrl.state().ghost === '', 'no ghost when disabled');
  });
}

async function testFimUsesLocalGenerate() {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    expect(url === 'http://127.0.0.1:11434/api/generate', `url ${url}`);
    expect(init?.method === 'POST', 'generate is POST');
    const body = JSON.parse(String(init?.body)) as { model?: string; prompt?: string; suffix?: string; stream?: boolean };
    expect(body.model === DEFAULT_COMPLETE_MODEL, `model ${body.model}`);
    expect(body.prompt === 'const ' && body.suffix === '\n', 'prefix and suffix');
    expect(body.stream === false, 'single response');
    return new Response(JSON.stringify({ response: 'answer = 1;' }), { status: 200 });
  };
  try {
    const text = await generateFim({ host: 'http://127.0.0.1:11434', prompt: 'const ', suffix: '\n' });
    expect(text === 'answer = 1;', text);
    expect(calls.length === 1, 'one generate call');
    calls.length = 0;
    globalThis.fetch = async () => {
      calls.push('nope');
      throw new Error('fetch should not run');
    };
    await expectThrow(() => generateFim({ host: 'https://api.openai.com/v1', prompt: 'a', suffix: 'b' }), /Refusing/, 'paid host');
    await expectThrow(() => generateFim({ host: 'http://8.8.8.8:11434', prompt: 'a', suffix: 'b' }), /Refusing/, 'public host');
    expect(calls.length === 0, 'refused hosts did not fetch');
  } finally {
    globalThis.fetch = original;
  }
}

async function main() {
  await testDebounceAcceptDismiss();
  await testUnhealthyDisables();
  await testFimUsesLocalGenerate();
  console.log('smoke-m10: PASS');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
