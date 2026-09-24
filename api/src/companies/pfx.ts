import forge from 'node-forge'
import { createHash } from 'node:crypto'

export interface PfxInfo {
  subject: string
  holderDocument: string
  issuer: string
  serial: string
  thumbprint: string
  validFrom: Date
  validTo: Date
}

// OIDs da ICP-Brasil no subjectAltName: 2.16.76.1.3.3 = CNPJ, 2.16.76.1.3.1 = dados do titular (CPF).
const OID_CNPJ = '2.16.76.1.3.3'

function findOidValue(node: forge.asn1.Asn1, oid: string): string | null {
  if (!Array.isArray(node.value)) return null
  const children = node.value as forge.asn1.Asn1[]
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!
    if (child.type === forge.asn1.Type.OID && forge.asn1.derToOid(child.value as string) === oid) {
      return leafText(children[i + 1])
    }
    const found = findOidValue(child, oid)
    if (found) return found
  }
  return null
}

function leafText(node: forge.asn1.Asn1 | undefined): string | null {
  if (!node) return null
  if (typeof node.value === 'string') return node.value
  for (const child of node.value as forge.asn1.Asn1[]) {
    const text = leafText(child)
    if (text) return text
  }
  return null
}

const attr = (cert: forge.pki.Certificate, name: string, from: 'subject' | 'issuer' = 'subject') =>
  String(cert[from].getField(name)?.value ?? '')

function cnpjOf(cert: forge.pki.Certificate): string | null {
  const san = cert.getExtension('subjectAltName') as { value?: string } | null
  if (san?.value) {
    const text = findOidValue(forge.asn1.fromDer(san.value), OID_CNPJ)
    const cnpj = text?.replace(/\D/g, '')
    if (cnpj?.length === 14) return cnpj
  }
  // Padrão comum no nome: "RAZAO SOCIAL:12345678000199"
  return attr(cert, 'CN').match(/:(\d{14})\s*$/)?.[1] ?? null
}

// Abre o .pfx com a senha e devolve os dados do certificado do titular.
export function readPfx(file: Buffer, password: string): PfxInfo {
  let p12: forge.pkcs12.Pkcs12Pfx
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(file.toString('binary'))), false, password)
  } catch (error: any) {
    if (/password|MAC/i.test(String(error?.message))) throw new Error('Senha do certificado incorreta')
    throw new Error('Arquivo não é um certificado A1 (.pfx/.p12) válido')
  }
  const keys = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ]
  const key = keys.find((b) => b.key)?.key as forge.pki.rsa.PrivateKey | undefined
  if (!key) throw new Error('O arquivo não tem a chave privada do certificado')
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).map((b) => b.cert).filter(Boolean) as forge.pki.Certificate[]
  // O certificado do titular é o que tem a mesma chave pública da chave privada.
  const cert = certs.find((c) => (c.publicKey as forge.pki.rsa.PublicKey).n?.equals(key.n))
  if (!cert) throw new Error('Não achei no arquivo o certificado da chave privada')

  const holderDocument = cnpjOf(cert)
  if (!holderDocument) throw new Error('Este certificado não é um e-CNPJ (não encontrei o CNPJ do titular)')
  const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary')
  return {
    subject: attr(cert, 'CN').replace(/:\d{14}\s*$/, '') || holderDocument,
    holderDocument,
    issuer: attr(cert, 'CN', 'issuer') || attr(cert, 'O', 'issuer'),
    serial: cert.serialNumber,
    thumbprint: createHash('sha256').update(der).digest('hex'),
    validFrom: cert.validity.notBefore,
    validTo: cert.validity.notAfter,
  }
}
