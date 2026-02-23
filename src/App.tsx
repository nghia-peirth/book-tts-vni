/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Home } from './screens/Home';
import { Reader } from './screens/Reader';

export default function App() {
  const [currentBookId, setCurrentBookId] = useState<string | null>(() => {
    return localStorage.getItem('last-opened-book-id');
  });

  const handleOpenBook = (id: string | null) => {
    setCurrentBookId(id);
    if (id) {
      localStorage.setItem('last-opened-book-id', id);
    } else {
      localStorage.removeItem('last-opened-book-id');
    }
  };
  
  if (currentBookId) {
    return <Reader bookId={currentBookId} onBack={() => handleOpenBook(null)} />;
  }

  return <Home onOpenBook={handleOpenBook} />;
}
