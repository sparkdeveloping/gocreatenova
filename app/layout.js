import './globals.css';
import { UserProvider } from './context/UserContext';

export const metadata = {
  title: 'GoCreate Nova',
  description: 'Next-generation makerspace digital ecosystem'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="relative min-h-screen bg-gradient-to-br from-white via-slate-100 to-white text-slate-900">
        <UserProvider>
          {children}
        </UserProvider>
      </body>
    </html>
  );
}
