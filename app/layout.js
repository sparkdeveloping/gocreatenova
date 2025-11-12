import './globals.css';
import AppProviders from './AppProviders';

export const metadata = {
  title: 'GoCreate Nova',
  description: 'Next-generation makerspace digital ecosystem'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AppProviders>
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
