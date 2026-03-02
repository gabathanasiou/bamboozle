import React from 'react';
import ReactDOM from 'react-dom/client';
import { AssetGenerator } from './src/Generator';
import './src/generator.css'; // Dedicated CSS for isolation

const root = document.getElementById('root');
if (root) {
    ReactDOM.createRoot(root).render(
        <React.StrictMode>
            <AssetGenerator />
        </React.StrictMode>
    );
}
