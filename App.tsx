import React, { useState, useEffect } from 'react';
import { Sparkles, Key } from 'lucide-react';
import GifEditor from './components/GifEditor';

function App() {
  const [isApiKeySelected, setIsApiKeySelected] = useState(false);

  useEffect(() => {
    checkApiKey();
  }, []);

  async function checkApiKey() {
    if (window.aistudio) {
      const hasKey = await window.aistudio.hasSelectedApiKey();
      setIsApiKeySelected(hasKey);
    } else {
      // Safety check for process.env to avoid crashes on Vercel/Client-side if not polyfilled
      try {
        if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
          setIsApiKeySelected(true);
        }
      } catch (e) {
        // Ignore reference errors
        console.warn("process.env access failed", e);
      }
    }
  }

  const handleSelectKey = async () => {
    if (window.aistudio) {
      try {
        await window.aistudio.openSelectKey();
        await checkApiKey();
      } catch (error: any) {
        console.error(error);
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-gray-100 selection:bg-indigo-500/30">
      
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-lg">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
              GifAlchemy
            </h1>
          </div>
          
          <div className="flex items-center gap-4">
             {!isApiKeySelected && window.aistudio && (
               <button 
                 onClick={handleSelectKey}
                 className="text-xs flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-medium transition-colors shadow-lg shadow-indigo-900/20"
               >
                 <Key className="w-3 h-3" />
                 Connect AI Key
               </button>
             )}
             <div className={`text-xs font-mono px-2 py-1 rounded border ${isApiKeySelected ? 'bg-indigo-900/30 border-indigo-500/30 text-indigo-400' : 'bg-gray-800 border-gray-700 text-gray-500'}`}>
               {isApiKeySelected ? 'AI ACTIVE' : 'OFFLINE MODE'}
             </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="py-12">
        <div className="max-w-7xl mx-auto px-4">
           <div className="text-center mb-12 space-y-4">
              <h2 className="text-4xl md:text-5xl font-bold text-white tracking-tight">
                Remix your GIFs
              </h2>
              <p className="text-lg text-gray-400 max-w-2xl mx-auto">
                Remove backgrounds or recolor objects. 
                <br/>
                <span className="text-sm opacity-70">
                  {isApiKeySelected 
                    ? "Using Gemini AI for high-quality smart editing." 
                    : "Running in Offline Mode. Connect API Key for AI features."}
                </span>
              </p>
           </div>
           
           <GifEditor apiKeyAvailable={isApiKeySelected} />
           
        </div>
      </main>
      
      {/* Footer */}
      <footer className="border-t border-gray-800 mt-20 py-8 text-center text-gray-600 text-sm">
        <p>Built with React, Tailwind, and Google Gemini API</p>
      </footer>
    </div>
  );
}

export default App;