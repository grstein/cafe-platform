/**
 * @fileoverview PIX BR Code generation.
 *
 * Wraps the `gpix` library to produce a static PIX EMV BR Code string.
 * Identifier prefix is controlled by the ORDER_PREFIX env var (shared
 * with order display in commands/tools).
 */

import { PIX } from "gpix/dist/index.js";

/**
 * Generate a PIX BR Code (copia e cola) for a given order.
 *
 * @param {{ key: string, name: string, city: string, orderId: number, amount: number }} params
 * @returns {string} The BR Code string.
 */
export function generatePixCode({ key, name, city, orderId, amount }) {
  // PIX identifiers must be alphanumeric only (the gpix library rejects dashes, etc.).
  const prefix = (process.env.ORDER_PREFIX || "").replace(/[^A-Za-z0-9]/g, "");
  const identifier = `${prefix}${orderId}`;
  return PIX.static()
    .setReceiverName(name)
    .setReceiverCity(city)
    .setKey(key)
    .setIdentificator(identifier)
    .setDescription(`Pedido ${identifier}`)
    .isUniqueTransaction(true)
    .setAmount(amount)
    .getBRCode();
}
