import { Footer, Layout, Navbar } from 'nextra-theme-docs'
import { Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import 'nextra-theme-docs/style.css'

export const metadata = {
  metadataBase: new URL('https://docs.lockedin.quest'),
  title: {
    default: 'Locked In Docs',
    template: '%s – Locked In Docs'
  },
  description:
    'How Locked In works: lock USDC, learn every day, complete your course, claim your principal and yield.'
}

const navbar = (
  <Navbar
    logo={
      <span style={{ fontWeight: 700 }}>
        Locked&nbsp;In <span style={{ opacity: 0.6, fontWeight: 400 }}>Docs</span>
      </span>
    }
    projectLink="https://www.lockedin.quest"
  />
)

const footer = (
  <Footer>
    Locked In — lock in, learn daily, earn your yield back.{' '}
    <a href="https://www.lockedin.quest">www.lockedin.quest</a>
  </Footer>
)

export default async function RootLayout({ children }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head color={{ hue: 265, saturation: 70 }} />
      <body>
        <Layout
          navbar={navbar}
          pageMap={await getPageMap()}
          footer={footer}
          nextThemes={{ defaultTheme: 'dark' }}
          editLink={null}
          feedback={{ content: null }}
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
