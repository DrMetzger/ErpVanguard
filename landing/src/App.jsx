import Header from './components/Header.jsx'
import Hero from './components/Hero.jsx'
import Modules from './components/Modules.jsx'
import Integrations from './components/Integrations.jsx'
import MobileApp from './components/MobileApp.jsx'
import Contact from './components/Contact.jsx'
import Footer from './components/Footer.jsx'

export default function App() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Modules />
        <Integrations />
        <MobileApp />
        <Contact />
      </main>
      <Footer />
    </>
  )
}
