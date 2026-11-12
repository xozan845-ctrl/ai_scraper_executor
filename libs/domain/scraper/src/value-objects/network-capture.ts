/** Respuesta de red capturada durante un render (XHR/fetch/GraphQL). */
export interface CapturedNetworkResponse {
  url: string;
  status: number;
  contentType: string;
  body: string;
}
