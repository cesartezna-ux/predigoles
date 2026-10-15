// El asunto de un correo (Subject) se manda sin codificar -- a diferencia
// del cuerpo, que sí soporta tildes y eñes sin problema (confirmado con
// pruebas reales en Titan/GoDaddy). Cualquier caracter fuera de ASCII en el
// asunto termina viéndose como "=?utf-8?Q?...?=" sin decodificar en algunos
// clientes de correo. Esto NO toca el cuerpo del correo -- solo úsalo para
// construir el asunto.
export function asciiSeguro(s: string): string {
  return s
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // separa letra+tilde (NFD) y quita la tilde: á -> a, ñ -> n
    .replace(/[^\x20-\x7e]/g, ""); // lo que siga fuera de ASCII imprimible (emoji, símbolos raros), se descarta
}
