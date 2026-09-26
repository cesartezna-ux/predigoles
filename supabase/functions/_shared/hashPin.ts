// Traducción EXACTA de _hashPinGS() en Code.gs (y _hashPin() en
// index.html -- deben ser idénticos para que un PIN hasheado en un lado
// se pueda comparar con el otro). No es un hash criptográfico fuerte --
// es un hash simple heredado del diseño original; la protección real
// contra fuerza bruta la da el rate limiting (_shared/rateLimit.ts), no
// la fuerza de este hash. Cambiarlo ahora rompería la compatibilidad con
// el frontend actual hasta que se reconecte en la subtarea 08.
export function hashPin(pin: string): string {
  let h = 0;
  for (let i = 0; i < pin.length; i++) {
    h = ((h << 5) - h) + pin.charCodeAt(i);
    h |= 0;
  }
  return "ph_" + Math.abs(h).toString(36);
}
