/** @jest-environment node */
import { isModelUnavailable, resetModelCache, withModelFallback } from '../openai';
import { VoiceError } from '../../utils/voiceErrors';

const unavailable = () =>
  new VoiceError('forbidden', 'OpenAI responded 403', "does not have access to model 'whisper-1'");

beforeEach(resetModelCache);

describe('isModelUnavailable', () => {
  it('recognises a forbidden model', () => {
    expect(isModelUnavailable(unavailable())).toBe(true);
    expect(
      isModelUnavailable(new VoiceError('server', 'boom', 'The model `x` does not exist (model_not_found)')),
    ).toBe(true);
  });

  it('does not mistake other failures for it', () => {
    expect(isModelUnavailable(new VoiceError('unauthorized', 'bad key'))).toBe(false);
    expect(isModelUnavailable(new VoiceError('offline', 'no connection'))).toBe(false);
    expect(isModelUnavailable(new Error('something else'))).toBe(false);
    expect(isModelUnavailable(null)).toBe(false);
  });
});

describe('withModelFallback', () => {
  it('uses the first candidate when it works', async () => {
    const tried: string[] = [];
    const result = await withModelFallback('t', ['a', 'b'], async (model) => {
      tried.push(model);
      return model;
    });

    expect(result).toBe('a');
    expect(tried).toEqual(['a']);
  });

  it('moves to the next model when one is not permitted', async () => {
    const tried: string[] = [];
    const result = await withModelFallback('t', ['a', 'b', 'c'], async (model) => {
      tried.push(model);
      if (model !== 'c') throw unavailable();
      return model;
    });

    expect(result).toBe('c');
    expect(tried).toEqual(['a', 'b', 'c']);
  });

  it('gives up immediately on a failure that is not about models', async () => {
    // Retrying a rejected key against four models is four rejections.
    const tried: string[] = [];
    await expect(
      withModelFallback('t', ['a', 'b'], async (model) => {
        tried.push(model);
        throw new VoiceError('unauthorized', 'bad key');
      }),
    ).rejects.toThrow('bad key');

    expect(tried).toEqual(['a']);
  });

  it('throws the last failure when no model is permitted', async () => {
    await expect(
      withModelFallback('t', ['a', 'b'], async () => {
        throw unavailable();
      }),
    ).rejects.toThrow(/403/);
  });

  it('remembers the model that worked, so the next call starts there', async () => {
    await withModelFallback('t', ['a', 'b'], async (model) => {
      if (model === 'a') throw unavailable();
      return model;
    });

    const tried: string[] = [];
    await withModelFallback('t', ['a', 'b'], async (model) => {
      tried.push(model);
      return model;
    });

    expect(tried).toEqual(['b']);
  });

  it('keeps purposes apart, since transcription and text models differ', async () => {
    await withModelFallback('transcribe', ['w'], async (m) => m);

    const tried: string[] = [];
    await withModelFallback('text', ['g'], async (model) => {
      tried.push(model);
      return model;
    });

    expect(tried).toEqual(['g']);
  });

  it('stops trusting a remembered model once it stops working', async () => {
    await withModelFallback('t', ['a', 'b'], async (m) => m);

    const tried: string[] = [];
    await withModelFallback('t', ['a', 'b'], async (model) => {
      tried.push(model);
      if (model === 'a') throw unavailable();
      return model;
    });

    expect(tried).toEqual(['a', 'b']);
  });

  it('refuses an empty candidate list rather than resolving with nothing', async () => {
    await expect(withModelFallback('t', [], async (m) => m)).rejects.toThrow(/no models/);
  });
});
