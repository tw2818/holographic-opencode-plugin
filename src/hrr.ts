import { createHash } from "crypto";

const TWO_PI = 2.0 * Math.PI;
const DIM_DEFAULT = 1024;
const ROLE_CONTENT = "__hrr_role_content__";
const ROLE_ENTITY = "__hrr_role_entity__";

/**
 * Encode a word into an HRR atom vector using SHA-256 counter mode.
 * Each hash produces 16 uint16 values (little-endian), scaled to [0, 2π).
 */
export function encode_atom(word: string, dim: number = DIM_DEFAULT): Float64Array {
  const result = new Float64Array(dim);
  let offset = 0;

  while (offset < dim) {
    // SHA-256 counter block: sha256("${word}:${i}")
    const hash = createHash("sha256");
    hash.update(`${word}:${offset >> 4}`); // Each hash gives 16 values
    const digest = hash.digest();

    // Extract 16 uint16 values (little-endian) from 32 bytes
    for (let j = 0; j < 16 && offset + j < dim; j++) {
      const value = digest[j * 2] | (digest[j * 2 + 1] << 8);
      result[offset + j] = value * (TWO_PI / 65536);
    }
    offset += 16;
  }

  return result;
}

/**
 * Bind two HRR vectors via element-wise phase addition modulo 2π.
 */
export function bind(a: Float64Array, b: Float64Array): Float64Array {
  const result = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = (a[i] + b[i]) % TWO_PI;
  }
  return result;
}

/**
 * Unbind (inverse of bind) via element-wise phase subtraction modulo 2π.
 */
export function unbind(memory: Float64Array, key: Float64Array): Float64Array {
  const result = new Float64Array(memory.length);
  for (let i = 0; i < memory.length; i++) {
    result[i] = (memory[i] - key[i]) % TWO_PI;
    if (result[i] < 0) result[i] += TWO_PI;
  }
  return result;
}

/**
 * Bundle multiple vectors via circular mean using complex exponentials.
 */
export function bundle(...vectors: Float64Array[]): Float64Array {
  if (vectors.length === 0) {
    return new Float64Array(DIM_DEFAULT);
  }
  if (vectors.length === 1) {
    return new Float64Array(vectors[0]);
  }

  const dim = vectors[0].length;
  const result = new Float64Array(dim);

  for (let i = 0; i < dim; i++) {
    let real = 0;
    let imag = 0;
    for (const v of vectors) {
      real += Math.cos(v[i]);
      imag += Math.sin(v[i]);
    }
    result[i] = Math.atan2(imag, real);
    if (result[i] < 0) result[i] += TWO_PI;
  }

  return result;
}

/**
 * Compute phase cosine similarity between two HRR vectors.
 * Returns value in range [-1, 1].
 */
export function similarity(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.cos(a[i] - b[i]);
  }
  return sum / a.length;
}

/**
 * Encode text into an HRR vector by tokenizing and bundling token atoms.
 */
export function encode_text(text: string, dim: number = DIM_DEFAULT): Float64Array {
  // Tokenize: lowercase, split whitespace, strip punctuation
  const tokens = text
    .toLowerCase()
    .split(/\s+/)
    .map(token => token.replace(/[^\w]/g, ""))
    .filter(token => token.length > 0);

  if (tokens.length === 0) {
    return new Float64Array(dim);
  }

  const atoms = tokens.map(token => encode_atom(token, dim));
  return bundle(...atoms);
}

/**
 * Encode a fact into an HRR vector by binding content and entities to roles.
 */
export function encode_fact(
  content: string,
  entities: string[],
  dim: number = DIM_DEFAULT
): Float64Array {
  // Encode role vectors
  const roleContentAtom = encode_atom(ROLE_CONTENT, dim);
  const roleEntityAtom = encode_atom(ROLE_ENTITY, dim);

  // Encode content and bind to role
  const contentAtom = encode_atom(content, dim);
  const boundContent = bind(roleContentAtom, contentAtom);

  // Encode each entity and bind to role
  const entityComponents = entities.map(entity => {
    const entityAtom = encode_atom(entity, dim);
    return bind(roleEntityAtom, entityAtom);
  });

  // Bundle all components
  return bundle(boundContent, ...entityComponents);
}

/**
 * Serialize a Float64Array of phases to Uint8Array.
 * Each float64 takes 8 bytes.
 */
export function phases_to_bytes(phases: Float64Array): Uint8Array {
  const bytes = new Uint8Array(phases.length * 8);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < phases.length; i++) {
    view.setFloat64(i * 8, phases[i], true); // little-endian
  }
  return bytes;
}

/**
 * Deserialize Uint8Array back to Float64Array of phases.
 */
export function bytes_to_phases(data: Uint8Array): Float64Array {
  const phases = new Float64Array(data.length / 8);
  const view = new DataView(data.buffer);
  for (let i = 0; i < phases.length; i++) {
    phases[i] = view.getFloat64(i * 8, true); // little-endian
  }
  return phases;
}

/**
 * Estimate SNR (Signal-to-Noise Ratio) for given dimensions and item count.
 * Returns sqrt(dim / n_items), logs warning if < 2.0.
 */
export function snr_estimate(dim: number, n_items: number): number {
  const snr = Math.sqrt(dim / n_items);
  if (snr < 2.0) {
    console.warn(`SNR estimate (${snr.toFixed(2)}) is below 2.0 - consider increasing dimensions`);
  }
  return snr;
}

// Re-export constants
export { TWO_PI, DIM_DEFAULT, ROLE_CONTENT, ROLE_ENTITY };