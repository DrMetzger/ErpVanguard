import { IconBuilding, IconCertificate, IconShare } from '@tabler/icons-react'
import { ModuleTabs } from '../components/ModuleTabs'
import Certificates from './cadastros/Certificates'
import Companies from './cadastros/Companies'
import BranchModes from './cadastros/BranchModes'

// Administração › Empresas: matriz e filiais (regime, logo) e certificado digital A1.
export default function Empresas() {
  return (
    <ModuleTabs base="/empresas" title="Empresas" tabs={[
      { path: 'empresas', label: 'Empresas e filiais', icon: IconBuilding, element: <Companies /> },
      { path: 'certificados', label: 'Certificado digital A1', icon: IconCertificate, element: <Certificates /> },
      { path: 'compartilhamento', label: 'Compartilhamento dos cadastros', icon: IconShare, element: <BranchModes /> },
    ]} />
  )
}
