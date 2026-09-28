import { IconBuilding, IconCertificate } from '@tabler/icons-react'
import { ModuleTabs } from '../components/ModuleTabs'
import Certificates from './cadastros/Certificates'
import Companies from './cadastros/Companies'

// Administração › Empresas: matriz e filiais (regime, logo) e certificado digital A1.
export default function Empresas() {
  return (
    <ModuleTabs base="/empresas" title="Empresas" tabs={[
      { path: 'empresas', label: 'Empresas e filiais', icon: IconBuilding, element: <Companies /> },
      { path: 'certificados', label: 'Certificado digital A1', icon: IconCertificate, element: <Certificates /> },
    ]} />
  )
}
