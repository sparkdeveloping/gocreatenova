'use client';

import CornerUtilities from './CornerUtilities';

export default function Shell({ children }) {
  return (
    <>
      <CornerUtilities />
      {children}
    </>
  );
}
