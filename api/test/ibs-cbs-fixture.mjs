// Tabela cClassTrib oficial (a mesma da carga inicial) para os testes sem banco.
import { CLASS_TRIB } from '../dist/database/data/cclasstrib.js'

export const classTrib = new Map(CLASS_TRIB.map((c) => [c.code, { ...c, id: c.code, active: true }]))
export const ibsParams = { MV_IBSCBS: true, MV_IBSCBSSN: false, MV_CBSALQ: 0.9, MV_IBSUFALQ: 0.1, MV_IBSMUNALQ: 0 }
