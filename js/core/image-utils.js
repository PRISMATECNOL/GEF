/**
 * GEF | IMAGENS: validação, compressão/redimensionamento no navegador e envio para o Supabase Storage.
 * Nunca se guarda Base64 na base de dados: só o caminho do ficheiro (product_images / configuração da loja).
 */
import { SUPABASE_URL } from '../config.js';

export const MAX_INPUT_BYTES = 12 * 1024 * 1024; // ficheiro original aceite (é comprimido antes do envio)
export const BUCKET = 'product-images';

export const publicImageUrl = (path) => (path ? `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}` : '');

async function sniffType(file) {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

/** Valida tipo (pelo conteúdo, não só pela extensão), tamanho e integridade (tem de descodificar). */
export async function validateImageFile(file) {
  if (!file) throw new Error('Nenhum ficheiro seleccionado.');
  if (file.size > MAX_INPUT_BYTES) throw new Error('A fotografia excede 12 MB.');
  const type = await sniffType(file);
  if (!type) throw new Error('Formato não suportado. Use JPG, PNG ou WebP.');
  return type;
}

export async function decode(file) {
  try { return await createImageBitmap(file); }
  catch (e) {
    return await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Ficheiro de imagem danificado.')); };
      img.src = url;
    });
  }
}

function toBlob(canvas, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((webp) => {
      if (webp && webp.type === 'image/webp') return resolve(webp);
      canvas.toBlob((jpg) => resolve(jpg), 'image/jpeg', quality);
    }, 'image/webp', quality);
  });
}

/** Redimensiona mantendo a proporção (nunca deforma nem aumenta). */
export async function resizeImage(source, maxSide, quality) {
  const w = source.width, h = source.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, cw, ch);
  const blob = await toBlob(canvas, quality);
  if (!blob) throw new Error('Não foi possível processar a imagem.');
  return blob;
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
const ext = (blob) => (blob.type === 'image/webp' ? 'webp' : 'jpg');

/**
 * Comprime (principal 1600 px, miniatura 400 px) e envia. Ficheiros com nome único => podem ter cache longa.
 * Devolve { path, thumb, size } para registar com fn_product_image_add / fn_product_image_replace.
 */
export async function uploadProductImage(client, storeId, folderId, file) {
  await validateImageFile(file);
  const src = await decode(file);
  const [main, thumb] = [await resizeImage(src, 1600, 0.82), await resizeImage(src, 400, 0.75)];
  if (src.close) src.close();
  const id = uid();
  const path = `${storeId}/${folderId}/${id}.${ext(main)}`;
  const thumbPath = `${storeId}/${folderId}/${id}_t.${ext(thumb)}`;
  const opts = (blob) => ({ contentType: blob.type, cacheControl: '31536000', upsert: false });
  const a = await client.storage.from(BUCKET).upload(path, main, opts(main));
  if (a.error) throw new Error(a.error.message || 'Falha no envio da fotografia.');
  const b = await client.storage.from(BUCKET).upload(thumbPath, thumb, opts(thumb));
  if (b.error) { await client.storage.from(BUCKET).remove([path]); throw new Error(b.error.message || 'Falha no envio da miniatura.'); }
  return { path, thumb: thumbPath, size: main.size };
}

export async function removeStoredImages(client, paths) {
  const list = (paths || []).filter(Boolean);
  if (list.length) await client.storage.from(BUCKET).remove(list);
}
