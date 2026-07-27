export default async function(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  const html = "<!DOCTYPE html><html><head><meta charset='UTF-8'><title>Teste</title></head><body><h1>OK</h1></body></html>";
  return res.status(200).send(html);
}