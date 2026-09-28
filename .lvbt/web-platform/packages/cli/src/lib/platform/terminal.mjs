import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { styleText } from 'node:util';
import { CliError } from '../arguments.mjs';

/** Color only when the output is a terminal that wants it (styleText honors NO_COLOR). */
export function paint(color, text, stream = process.stdout) {
  return styleText(color, text, { stream });
}

/** Printable bytes typed or pasted, without escape sequences such as bracketed paste markers. */
export function cleanTyped(text) {
  // eslint-disable-next-line no-control-regex -- terminal escape sequences are control characters
  return text.replace(/\u001b\[[0-9;]*[~A-Za-z]/g, '').trim();
}

/**
 * Read a line without echoing it, for secrets. Backspace edits, Enter
 * finishes, and Ctrl-C stops the command.
 */
function readHidden(input, output, question) {
  return new Promise((resolve, reject) => {
    output.write(question);
    const wasRaw = input.isRaw;
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    let value = '';
    const done = (error) => {
      input.off('data', onData);
      input.setRawMode(wasRaw);
      input.pause();
      output.write('\n');
      if (error) reject(error);
      else resolve(cleanTyped(value));
    };
    function onData(chunk) {
      for (const char of chunk) {
        if (char === '\r' || char === '\n' || char === '\u0004') return done();
        if (char === '\u0003')
          return done(
            new CliError('Stopped. Nothing was saved for the value you were typing.', 130),
          );
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
      return undefined;
    }
    input.on('data', onData);
  });
}

function openCommand(url) {
  if (process.platform === 'darwin') return ['open', [url]];
  if (process.platform === 'win32') return ['cmd', ['/c', 'start', '""', url]];
  return ['xdg-open', [url]];
}

/** The real terminal. Tests pass an object with the same methods. */
export function terminalIo({ input = process.stdin, output = process.stdout } = {}) {
  const ask = async (question) => {
    const readline = createInterface({ input, output });
    try {
      return (await readline.question(question)).trim();
    } finally {
      readline.close();
    }
  };
  return {
    interactive: Boolean(input.isTTY && output.isTTY) && !process.env.CI,
    write: (text) => output.write(text),
    ask,
    askHidden: (question) => readHidden(input, output, question),
    confirm: async (question, byDefault) => {
      const answer = await ask(`${question} ${byDefault ? '[Y/n]' : '[y/N]'} `);
      return answer === '' ? byDefault : /^y(es)?$/i.test(answer);
    },
    open: (url) => {
      const [command, args] = openCommand(url);
      try {
        spawn(command, args, { stdio: 'ignore', detached: true })
          .on('error', () => undefined)
          .unref();
      } catch {
        // The link is printed too, so a missing opener costs nothing.
      }
    },
  };
}
