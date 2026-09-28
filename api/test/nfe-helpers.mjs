// Funções comuns dos testes da NF-e: A1 de teste, conferência da assinatura, dos totais e da chave.
import assert from 'node:assert/strict'
import { createHash, createVerify, X509Certificate } from 'node:crypto'
import forge from 'node-forge'
import { mod11 } from '../dist/nfe/nfe-xml.js'

export function makePfx(document, name, password, days = 365) {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '0' + Math.floor(Math.random() * 1e12).toString(16)
  cert.validity.notBefore = new Date(Date.now() - 86400e3)
  cert.validity.notAfter = new Date(Date.now() + days * 86400e3)
  cert.setSubject([{ name: 'commonName', value: `${name}:${document}` }, { name: 'countryName', value: 'BR' }])
  cert.setIssuer([{ name: 'commonName', value: 'AC Teste' }])
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return forge.util.encode64(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des' })).getBytes())
}

// Confere a assinatura sem usar o assinador: digest SHA-1 do infNFe canônico (com o xmlns herdado) e RSA-SHA1 do SignedInfo.
export function verifySignature(signed) {
  const inf = signed.match(/<infNFe[^>]*>[\s\S]*<\/infNFe>/)[0].replace('<infNFe ', '<infNFe xmlns="http://www.portalfiscal.inf.br/nfe" ')
  const digest = createHash('sha1').update(inf).digest('base64')
  assert.equal(signed.match(/<DigestValue>([^<]+)<\/DigestValue>/)[1], digest, 'digest do infNFe')
  // C14N: elementos vazios viram <x ...></x>
  const signedInfo = signed.match(/<SignedInfo[\s\S]*<\/SignedInfo>/)[0].replace(/<([A-Za-z]+)([^>]*?)\/>/g, '<$1$2></$1>')
  const certB64 = signed.match(/<X509Certificate>([^<]+)<\/X509Certificate>/)[1]
  const x509 = new X509Certificate(Buffer.from(certB64, 'base64'))
  const ok = createVerify('RSA-SHA1').update(signedInfo).verify(x509.publicKey, signed.match(/<SignatureValue>([^<]+)<\/SignatureValue>/)[1], 'base64')
  assert.ok(ok, 'assinatura RSA do SignedInfo')
  const uri = signed.match(/<Reference URI="#([^"]+)"/)[1]
  assert.equal(uri, signed.match(/<infNFe Id="([^"]+)"/)[1])
}

const tagSum = (xml, name) => [...xml.matchAll(new RegExp(`<det nItem[\\s\\S]*?</det>`, 'g'))].reduce((s, m) => s + [...m[0].matchAll(new RegExp(`<${name}>([^<]+)</${name}>`, 'g'))].reduce((a, x) => a + Number(x[1]), 0), 0)
const tot = (xml, name) => Number(xml.match(new RegExp(`<ICMSTot>[\\s\\S]*?<${name}>([^<]+)</${name}>`))[1])
const r2 = (n) => Math.round(n * 100) / 100

// Confere se o ICMSTot bate com a soma dos itens, como a SEFAZ faz (rejeições 531, 532, 564, 610...).
export function checkTotals(xml) {
  for (const [item, total] of [['vProd', 'vProd'], ['vDesc', 'vDesc'], ['vFrete', 'vFrete'], ['vICMS', 'vICMS'], ['vBC', 'vBC'], ['vBCST', 'vBCST'], ['vICMSST', 'vST'], ['vFCPST', 'vFCPST'],
    ['vFCP', 'vFCP'], ['vIPI', 'vIPI'], ['vPIS', 'vPIS'], ['vCOFINS', 'vCOFINS'], ['vICMSUFDest', 'vICMSUFDest'], ['vFCPUFDest', 'vFCPUFDest']]) {
    const itemSum = item === 'vBC'
      ? [...xml.matchAll(/<ICMS>[\s\S]*?<\/ICMS>/g)].reduce((s, m) => s + Number(m[0].match(/<vBC>([^<]+)<\/vBC>/)?.[1] ?? 0), 0)
      : tagSum(xml, item)
    const t = xml.includes(`<ICMSTot>`) && new RegExp(`<ICMSTot>[\\s\\S]*<${total}>`).test(xml) ? tot(xml, total) : 0
    assert.equal(r2(itemSum), t, `${item}: itens ${itemSum} × total ${t}`)
  }
  const vNF = r2(tot(xml, 'vProd') - tot(xml, 'vDesc') + tot(xml, 'vST') + tot(xml, 'vFCPST') + tot(xml, 'vFrete') + tot(xml, 'vSeg') + tot(xml, 'vOutro') + tot(xml, 'vII') + tot(xml, 'vIPI'))
  assert.equal(tot(xml, 'vNF'), vNF, 'vNF = vProd − vDesc + vST + vFCPST + vFrete + vIPI')
  for (const m of xml.matchAll(/<qCom>([^<]+)<\/qCom><vUnCom>([^<]+)<\/vUnCom><vProd>([^<]+)<\/vProd>/g)) assert.ok(Math.abs(Number(m[1]) * Number(m[2]) - Number(m[3])) <= 0.01, 'vProd = qCom × vUnCom')
  const vPag = Number(xml.match(/<vPag>([^<]+)<\/vPag>/)[1])
  if (!xml.includes('<tPag>90</tPag>')) assert.equal(vPag, tot(xml, 'vNF'), 'pagamento = total da nota')
  const dups = [...xml.matchAll(/<vDup>([^<]+)<\/vDup>/g)].reduce((s, m) => s + Number(m[1]), 0)
  if (dups) assert.equal(r2(dups), Number(xml.match(/<vLiq>([^<]+)<\/vLiq>/)[1]), 'duplicatas = valor líquido da fatura')
}

export function checkKey(xml, key) {
  assert.match(key, /^\d{44}$/)
  assert.equal(Number(key.slice(-1)), mod11(key.slice(0, 43)), 'DV da chave')
  assert.equal(xml.match(/<cDV>(\d)<\/cDV>/)[1], key.slice(-1))
  assert.equal(xml.match(/<cNF>(\d{8})<\/cNF>/)[1], key.slice(35, 43))
  assert.notEqual(Number(key.slice(35, 43)), Number(xml.match(/<nNF>(\d+)<\/nNF>/)[1]), 'cNF diferente do nNF')
}

