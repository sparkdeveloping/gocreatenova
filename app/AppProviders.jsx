'use client';

import React from 'react';
// Adjust this path if your UserContext file lives elsewhere
import { UserProvider } from './context/UserContext';

export default function AppProviders({ children }) {
  return (
    <UserProvider>
      {children}
    </UserProvider>
  );
}
