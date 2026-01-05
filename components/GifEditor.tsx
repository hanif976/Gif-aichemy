import React, { useState, useRef, useEffect } from 'react';
import { Play, Download, Wand2, Layers, Loader2, Image as ImageIcon, Zap, Cpu, AlertCircle, Pipette, Plus, Trash2, Check, X, FileVideo, Settings, PlayCircle } from 'lucide-react';
import { GifFrame, ProcessingStatus } from '../types';
import { parseGifFrames, imageDataToBase64, createGif, resizeFrame, processFrameLocal } from '../services/gifService';
import { editFrameWithGemini } from '../services/geminiService';
import { MAX_FRAMES, MAX_WIDTH } from '../constants';

interface GifEditorProps {
  apiKeyAvailable: boolean;
}

interface RecolorPair {
    id: string;
    original: string;
    target: string;
    objectDescription?: string; // For AI
}

// Shared Configuration Interface
interface EditorConfig {
    activeModes: ('recolor' | 'remove-bg')[];
    recolorPairs: RecolorPair[];
    bgRemoveColor: string;
    bgReplaceColor: string;
}

// Project State Interface
interface GifProject extends EditorConfig {
    id: string;
    file: File;
    name: string; // Original filename (no extension)
    frames: GifFrame[];
    
    // Status
    status: ProcessingStatus;
    progress: number;
    error: string | null;
    resultBlob: Blob | null;
}

const GifEditor: React.FC<GifEditorProps> = ({ apiKeyAvailable }) => {
  // --- STATE ---
  
  // 1. Global Settings State (The "General Setting")
  const [globalSettings, setGlobalSettings] = useState<EditorConfig>({
      activeModes: ['remove-bg'],
      recolorPairs: [{ id: '1', original: '#FF0000', target: '#00FF00', objectDescription: '' }],
      bgRemoveColor: '#00FF00',
      bgReplaceColor: 'transparent'
  });

  const [projects, setProjects] = useState<GifProject[]>([]);
  // activeProjectId can be a UUID or 'GLOBAL'
  const [activeProjectId, setActiveProjectId] = useState<string>('GLOBAL');
  const [useAI, setUseAI] = useState(apiKeyAvailable);
  
  // Batch Processing State
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  
  const abortRef = useRef(false);
  const MAX_PROJECTS = 10;

  // Sync AI availability
  useEffect(() => {
    setUseAI(apiKeyAvailable);
  }, [apiKeyAvailable]);

  // Derived Data
  const isGlobalMode = activeProjectId === 'GLOBAL';
  const activeProject = projects.find(p => p.id === activeProjectId) || null;
  const isProcessingAny = projects.some(p => p.status === ProcessingStatus.PROCESSING || p.status === ProcessingStatus.ENCODING);

  // Determine which config to display/edit
  const currentConfig: EditorConfig | null = isGlobalMode ? globalSettings : activeProject;

  // --- ACTIONS ---

  // Helper to update global or active project
  const updateCurrentConfig = (updates: Partial<EditorConfig>) => {
      if (isGlobalMode) {
          setGlobalSettings(prev => ({ ...prev, ...updates }));
      } else if (activeProjectId) {
          setProjects(prev => prev.map(p => p.id === activeProjectId ? { ...p, ...updates } : p));
      }
  };

  const updateProjectStatus = (id: string, updates: Partial<GifProject>) => {
      setProjects(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  // Apply Global Settings to ALL Projects
  const applyGlobalToAll = () => {
      if (isProcessingAny) {
          alert("Please wait for current processing to finish.");
          return;
      }
      
      const confirmApply = window.confirm(`Apply these settings to all ${projects.length} GIFs? This will reset their processing status.`);
      if (!confirmApply) return;

      setProjects(prev => prev.map(p => ({
          ...p,
          ...globalSettings,
          // Generate fresh IDs for recolor pairs to avoid React key collisions
          recolorPairs: globalSettings.recolorPairs.map(rp => ({...rp, id: Math.random().toString(36).substr(2, 9)})),
          status: (p.frames.length > 0) ? ProcessingStatus.IDLE : ProcessingStatus.ERROR,
          error: (p.frames.length > 0) ? null : p.error,
          resultBlob: null,
          progress: 0
      })));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    
    const files: File[] = Array.from(fileList);
    const spacesAvailable = MAX_PROJECTS - projects.length;
    const filesToProcess = files.slice(0, spacesAvailable);
    
    if (filesToProcess.length < files.length) {
        alert(`Limit reached. Only adding ${filesToProcess.length} files.`);
    }

    const newProjects: GifProject[] = [];

    for (const file of filesToProcess) {
        const projectId = Math.random().toString(36).substr(2, 9);
        const name = file.name.replace(/\.[^/.]+$/, ""); 
        
        // Initialize with GLOBAL SETTINGS
        const project: GifProject = {
            id: projectId,
            file,
            name,
            frames: [],
            // Inherit from Global
            activeModes: [...globalSettings.activeModes],
            recolorPairs: globalSettings.recolorPairs.map(p => ({...p, id: Math.random().toString(36).substr(2, 9)})),
            bgRemoveColor: globalSettings.bgRemoveColor,
            bgReplaceColor: globalSettings.bgReplaceColor,
            
            status: ProcessingStatus.PARSING,
            progress: 0,
            error: null,
            resultBlob: null
        };
        
        newProjects.push(project);
    }

    setProjects(prev => [...prev, ...newProjects]);
    
    // Process parsing in background
    newProjects.forEach(async (proj) => {
        try {
            const parsedFrames = await parseGifFrames(proj.file);
            
            let processedFrames = parsedFrames;
            if (processedFrames.length > MAX_FRAMES) {
                const stride = Math.ceil(processedFrames.length / MAX_FRAMES);
                processedFrames = processedFrames.filter((_, i) => i % stride === 0).map(f => ({
                    ...f,
                    delay: f.delay * stride
                }));
            }
            
            const resizedFrames = processedFrames.map(f => ({
                ...f,
                imageData: resizeFrame(f.imageData, MAX_WIDTH)
            }));

            updateProjectStatus(proj.id, { frames: resizedFrames, status: ProcessingStatus.IDLE });

        } catch (err) {
            updateProjectStatus(proj.id, { status: ProcessingStatus.ERROR, error: "Failed to parse GIF." });
        }
    });
  };

  const removeProject = (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setProjects(prev => prev.filter(p => p.id !== id));
      if (activeProjectId === id) {
          setActiveProjectId('GLOBAL');
      }
  };

  // --- BATCH HELPERS ---

  const startBatchProcessing = () => {
      setIsBatchProcessing(true);
      abortRef.current = false; 
  };

  const stopBatchProcessing = () => {
      setIsBatchProcessing(false);
      abortRef.current = true;
  };

  // --- EDITOR HELPERS (Generic for Global or Project) ---

  const toggleMode = (mode: 'recolor' | 'remove-bg') => {
    if (!currentConfig) return;
    const currentModes = currentConfig.activeModes;
    const newModes = currentModes.includes(mode)
      ? currentModes.filter(m => m !== mode)
      : [...currentModes, mode];
    
    updateCurrentConfig({ activeModes: newModes });
  };

  const addRecolorPair = () => {
    if (!currentConfig) return;
    const newPair: RecolorPair = {
        id: Math.random().toString(36).substr(2, 9),
        original: '#000000',
        target: '#FFFFFF',
        objectDescription: ''
    };
    updateCurrentConfig({ recolorPairs: [...currentConfig.recolorPairs, newPair] });
  };

  const removeRecolorPair = (id: string) => {
      if (!currentConfig) return;
      updateCurrentConfig({ recolorPairs: currentConfig.recolorPairs.filter(p => p.id !== id) });
  };

  const updateRecolorPair = (id: string, field: keyof RecolorPair, value: string) => {
      if (!currentConfig) return;
      updateCurrentConfig({ 
          recolorPairs: currentConfig.recolorPairs.map(p => p.id === id ? { ...p, [field]: value } : p) 
      });
  };

  // --- PROCESSING LOGIC ---

  const triggerProcessProject = async (project: GifProject) => {
    if (project.frames.length === 0) {
        updateProjectStatus(project.id, { status: ProcessingStatus.ERROR, error: "No frames to process." });
        return;
    }
    
    if (project.activeModes.length === 0) {
        updateProjectStatus(project.id, { status: ProcessingStatus.ERROR, error: "No modes selected." });
        return;
    }

    abortRef.current = false;
    updateProjectStatus(project.id, { status: ProcessingStatus.PROCESSING, progress: 0, error: null });
    
    const activeUseAI = useAI && apiKeyAvailable;
    const CONCURRENCY = 2;
    const workingFrames = [...project.frames];

    // Build Instruction
    const instructions: string[] = [];
    if (project.activeModes.includes('recolor')) {
        const changes = project.recolorPairs.map(p => {
             const obj = p.objectDescription || 'object with this color';
             return `Change the ${obj} to ${p.target} (Hex ${p.target})`;
        }).join(', and ');
        instructions.push(changes);
    }
    const combinedInstruction = instructions.join('. ');

    const results: ImageData[] = new Array(workingFrames.length);
    let completedCount = 0;
    let quotaLimitReached = false;

    const processSingleFrame = async (frame: GifFrame, index: number) => {
        if (abortRef.current) return;

        let processedImageData: ImageData | null = null;

        // 1. Try AI
        if (activeUseAI && !quotaLimitReached) {
            try {
                // Stagger delay based on index to avoid burst rate limits
                await new Promise(resolve => setTimeout(resolve, index * 200));
                
                const base64 = imageDataToBase64(frame.imageData);
                const processedBase64 = await editFrameWithGemini(base64, combinedInstruction, project.activeModes);
                
                const img = new Image();
                img.src = `data:image/png;base64,${processedBase64}`;
                await new Promise((resolve) => { img.onload = resolve; });
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx?.drawImage(img, 0, 0);
                
                if (ctx) {
                    let aiData = ctx.getImageData(0, 0, img.width, img.height);
                    if (project.activeModes.includes('remove-bg') && project.bgReplaceColor !== 'transparent') {
                        aiData = processFrameLocal(aiData, ['remove-bg'], {
                            removeBgColor: '#00FF00',
                            bgReplacementColor: project.bgReplaceColor
                        });
                    }
                    processedImageData = aiData;
                }
            } catch (err: any) {
                const isQuota = err.message?.includes('429') || err.message?.includes('quota') || err.message?.includes('exhausted');
                if (isQuota) {
                     console.warn("Quota exceeded.");
                     quotaLimitReached = true;
                }
            }
        }

        // 2. Fallback
        if (!processedImageData) {
            processedImageData = processFrameLocal(
                frame.imageData, 
                project.activeModes, 
                {
                    recolorPairs: project.recolorPairs,
                    removeBgColor: project.bgRemoveColor,
                    bgReplacementColor: project.bgReplaceColor === 'transparent' ? null : project.bgReplaceColor
                }
            );
        }

        results[index] = processedImageData!;
        completedCount++;
        
        setProjects(prev => prev.map(p => p.id === project.id ? { 
            ...p, 
            progress: Math.round((completedCount / workingFrames.length) * 100) 
        } : p));
    };

    try {
      const queue = workingFrames.map((frame, index) => ({ frame, index }));
      const workers = Array(Math.min(CONCURRENCY, queue.length)).fill(null).map(async () => {
          while(queue.length > 0 && !abortRef.current) {
              const { frame, index } = queue.shift()!;
              await processSingleFrame(frame, index);
          }
      });
      await Promise.all(workers);

      if (abortRef.current) {
          updateProjectStatus(project.id, { status: ProcessingStatus.IDLE, progress: 0 });
          return;
      }

      const finalProcessedFrames = results.filter(f => !!f);
      updateProjectStatus(project.id, { status: ProcessingStatus.ENCODING });
      
      let transparentKey: number | null = null;
      if (project.activeModes.includes('remove-bg') && project.bgReplaceColor === 'transparent') {
          if (activeUseAI && !quotaLimitReached) transparentKey = 0x00FF00;
          else transparentKey = null; 
      }

      const blob = await createGif(
        finalProcessedFrames, 
        workingFrames.map(f => f.delay),
        transparentKey
      );
      updateProjectStatus(project.id, { status: ProcessingStatus.COMPLETED, resultBlob: blob });

    } catch (err) {
      console.error(err);
      updateProjectStatus(project.id, { status: ProcessingStatus.ERROR, error: "Processing failed." });
    }
  };

  useEffect(() => {
      if (!isBatchProcessing) return;
      if (isProcessingAny) return; 

      const nextProject = projects.find(p => p.status === ProcessingStatus.IDLE);
      if (nextProject) {
          triggerProcessProject(nextProject);
      } else {
          setIsBatchProcessing(false);
      }
  }, [isBatchProcessing, projects, isProcessingAny]);

  const downloadGif = () => {
    if (!activeProject || !activeProject.resultBlob) return;
    const url = URL.createObjectURL(activeProject.resultBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeProject.file.name; 
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };


  return (
    <div className="w-full max-w-6xl mx-auto p-4 md:p-6 space-y-8 flex flex-col md:flex-row gap-6">
      
      {/* SIDEBAR: Project List */}
      <div className="md:w-72 flex-shrink-0 flex flex-col gap-4 h-full">
          
          {/* GLOBAL SETTINGS CARD */}
          <div 
             onClick={() => setActiveProjectId('GLOBAL')}
             className={`
                p-4 rounded-xl border cursor-pointer transition-all flex items-center gap-3 relative overflow-hidden
                ${isGlobalMode 
                    ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-900/40' 
                    : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600 hover:bg-gray-800/80'
                }
             `}
          >
             <div className={`p-2 rounded-lg ${isGlobalMode ? 'bg-white/20' : 'bg-gray-900'}`}>
                <Settings className="w-5 h-5" />
             </div>
             <div>
                 <h3 className="font-bold text-sm">Global Settings</h3>
                 <p className={`text-xs ${isGlobalMode ? 'text-indigo-200' : 'text-gray-500'}`}>Applies to all new GIFs</p>
             </div>
          </div>

          <div className="w-full h-px bg-gray-800 my-1"></div>

          {/* BATCH ACTIONS */}
          {projects.length > 0 && (
             <div className="bg-gray-800/40 p-3 rounded-xl border border-gray-700 flex flex-col gap-2">
                 {!isBatchProcessing ? (
                     <button 
                        onClick={startBatchProcessing}
                        disabled={!projects.some(p => p.status === ProcessingStatus.IDLE) || isProcessingAny}
                        className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-medium text-white flex items-center justify-center gap-2 disabled:opacity-50 disabled:bg-gray-700"
                     >
                        <PlayCircle className="w-3 h-3" />
                        Process All Pending
                     </button>
                 ) : (
                    <button 
                        onClick={stopBatchProcessing}
                        className="w-full py-2 bg-red-900/50 border border-red-500/50 hover:bg-red-900/70 rounded-lg text-xs font-medium text-red-200 flex items-center justify-center gap-2"
                    >
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Stop Queue
                    </button>
                 )}
             </div>
          )}

          {/* LIST */}
          <div className="space-y-2 flex-1 overflow-y-auto min-h-0 pr-1 max-h-[500px]">
              {projects.map(proj => (
                  <div 
                    key={proj.id}
                    onClick={() => setActiveProjectId(proj.id)}
                    className={`
                        p-3 rounded-lg border cursor-pointer transition-all relative group
                        ${activeProjectId === proj.id 
                            ? 'bg-indigo-900/20 border-indigo-500/50 shadow-lg shadow-indigo-900/10' 
                            : 'bg-gray-800/30 border-gray-700 hover:border-gray-600'
                        }
                    `}
                  >
                      <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded bg-gray-900 flex items-center justify-center overflow-hidden flex-shrink-0 relative">
                                {proj.frames.length > 0 ? (
                                    <canvas 
                                        width={proj.frames[0].imageData.width}
                                        height={proj.frames[0].imageData.height}
                                        ref={c => c?.getContext('2d')?.putImageData(proj.frames[0].imageData, 0, 0)}
                                        className="w-full h-full object-contain"
                                    />
                                ) : (
                                    <FileVideo className="w-5 h-5 text-gray-600" />
                                )}
                                {/* Overlay Status Icon */}
                                {proj.status === ProcessingStatus.COMPLETED && (
                                    <div className="absolute inset-0 bg-green-500/80 flex items-center justify-center">
                                        <Check className="w-5 h-5 text-white" />
                                    </div>
                                )}
                                {proj.status === ProcessingStatus.PROCESSING && (
                                    <div className="absolute inset-0 bg-indigo-500/80 flex items-center justify-center">
                                        <Loader2 className="w-5 h-5 text-white animate-spin" />
                                    </div>
                                )}
                                {proj.status === ProcessingStatus.ERROR && (
                                    <div className="absolute inset-0 bg-red-500/80 flex items-center justify-center">
                                        <AlertCircle className="w-5 h-5 text-white" />
                                    </div>
                                )}
                          </div>
                          <div className="flex-1 min-w-0">
                              <h4 className="text-sm font-medium text-gray-200 truncate">{proj.name}</h4>
                              <p className="text-xs text-gray-500 flex justify-between">
                                  <span>{proj.status === ProcessingStatus.COMPLETED ? 'Done' : proj.frames.length + ' frames'}</span>
                                  {proj.status === ProcessingStatus.PROCESSING && <span>{proj.progress}%</span>}
                              </p>
                          </div>
                      </div>
                      
                      <button 
                        onClick={(e) => removeProject(proj.id, e)}
                        className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm z-10"
                      >
                          <X className="w-3 h-3" />
                      </button>
                  </div>
              ))}
          </div>

          {/* UPLOAD BOX */}
          <div className={`
            border-2 border-dashed rounded-xl p-4 text-center transition-all cursor-pointer relative overflow-hidden group flex-shrink-0 mt-auto
            ${projects.length < MAX_PROJECTS ? 'border-gray-700 bg-gray-800/30 hover:bg-gray-800/50 hover:border-indigo-500/50' : 'opacity-50 cursor-not-allowed border-gray-800'}
          `}>
             <input 
                type="file" 
                multiple
                accept="image/gif" 
                onChange={handleFileUpload}
                className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed" 
                disabled={projects.length >= MAX_PROJECTS}
             />
             <div className="flex flex-col items-center gap-2">
                 <Plus className="w-5 h-5 text-gray-400 group-hover:text-indigo-400" />
                 <span className="text-xs font-medium text-gray-400">Add GIFs ({projects.length}/{MAX_PROJECTS})</span>
             </div>
          </div>
      </div>

      {/* MAIN EDITOR AREA */}
      <div className="flex-1 min-w-0 flex flex-col">
        {!currentConfig ? (
            <div className="h-96 flex flex-col items-center justify-center text-gray-500 border-2 border-dashed border-gray-800 rounded-2xl bg-gray-900/20">
                <Layers className="w-12 h-12 mb-4 opacity-20" />
                <p>Select Global Settings or a GIF to edit</p>
            </div>
        ) : (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            
            {/* Controls */}
            <div className="space-y-6 bg-gray-900/50 p-6 rounded-2xl border border-gray-800 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold flex items-center gap-2 truncate pr-2">
                    <Wand2 className="w-5 h-5 text-indigo-400" />
                    {isGlobalMode ? 'Global Configuration' : `Editor: ${activeProject?.name}`}
                    </h2>
                    <button 
                        onClick={() => apiKeyAvailable && setUseAI(!useAI)}
                        disabled={!apiKeyAvailable}
                        className={`text-xs px-2 py-1 rounded border flex items-center gap-1 transition-colors flex-shrink-0 ${
                        useAI && apiKeyAvailable
                            ? 'bg-indigo-900/50 border-indigo-500 text-indigo-300' 
                            : 'bg-gray-800 border-gray-600 text-gray-400'
                        } ${!apiKeyAvailable ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        {useAI && apiKeyAvailable ? <Zap className="w-3 h-3" /> : <Cpu className="w-3 h-3" />}
                        {useAI && apiKeyAvailable ? 'AI Enabled' : 'Offline Mode'}
                    </button>
                </div>
                
                {isGlobalMode && (
                    <div className="p-3 bg-indigo-900/20 border border-indigo-500/30 rounded-lg text-xs text-indigo-200 flex items-start gap-2">
                        <Settings className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <div>
                            Changes made here will apply to all <strong>future uploads</strong>.
                            You can also apply them to existing GIFs below.
                        </div>
                    </div>
                )}

                <div className="space-y-6">
                {/* Mode Toggles */}
                <div className="flex gap-4">
                    <button
                        onClick={() => toggleMode('remove-bg')}
                        className={`flex-1 p-3 rounded-xl border flex items-center justify-between transition-all ${
                            currentConfig.activeModes.includes('remove-bg')
                            ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-lg shadow-indigo-500/10'
                            : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:border-gray-600'
                        }`}
                    >
                        <div className="flex items-center gap-2">
                            <Layers className="w-4 h-4" />
                            <span className="text-sm font-medium">Remove BG</span>
                        </div>
                        {currentConfig.activeModes.includes('remove-bg') && <Check className="w-4 h-4 text-indigo-400" />}
                    </button>

                    <button
                        onClick={() => toggleMode('recolor')}
                        className={`flex-1 p-3 rounded-xl border flex items-center justify-between transition-all ${
                            currentConfig.activeModes.includes('recolor')
                            ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-lg shadow-indigo-500/10'
                            : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:border-gray-600'
                        }`}
                    >
                        <div className="flex items-center gap-2">
                            <Pipette className="w-4 h-4" />
                            <span className="text-sm font-medium">Recolor</span>
                        </div>
                        {currentConfig.activeModes.includes('recolor') && <Check className="w-4 h-4 text-indigo-400" />}
                    </button>
                </div>

                {/* REMOVE BG MODE CONTROLS */}
                {currentConfig.activeModes.includes('remove-bg') && (
                    <div className="space-y-4 p-4 bg-gray-800/50 rounded-xl border border-gray-700/50 text-sm text-gray-300 animate-in fade-in slide-in-from-top-2">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Background Settings</h3>
                    
                    {(!useAI || !apiKeyAvailable) && (
                        <div className="mb-4">
                            <label className="block text-sm text-gray-400 mb-1 flex justify-between">
                                <span>Background Color to Remove</span>
                            </label>
                            <div className="flex gap-2">
                                <input
                                    type="color"
                                    value={currentConfig.bgRemoveColor}
                                    onChange={(e) => updateCurrentConfig({ bgRemoveColor: e.target.value })}
                                    className="h-10 w-12 bg-transparent border-0 cursor-pointer rounded overflow-hidden"
                                />
                                <div className="flex-1 text-xs text-gray-500 flex items-center">
                                    Pick dominant background color.
                                </div>
                            </div>
                        </div>
                    )}

                    <div>
                        <label className="block text-sm text-gray-400 mb-1">Replace Background With</label>
                        <div className="flex flex-col gap-2">
                            <select 
                                value={currentConfig.bgReplaceColor === 'transparent' ? 'transparent' : 'solid'}
                                onChange={(e) => updateCurrentConfig({ bgReplaceColor: e.target.value === 'transparent' ? 'transparent' : '#FFFFFF' })}
                                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white outline-none"
                            >
                                <option value="transparent">Transparent</option>
                                <option value="solid">Solid Color</option>
                            </select>
                            
                            {currentConfig.bgReplaceColor !== 'transparent' && (
                                <div className="flex gap-2 animate-in fade-in slide-in-from-top-1">
                                    <input
                                        type="color"
                                        value={currentConfig.bgReplaceColor}
                                        onChange={(e) => updateCurrentConfig({ bgReplaceColor: e.target.value })}
                                        className="h-10 w-12 bg-transparent border-0 cursor-pointer rounded overflow-hidden"
                                    />
                                    <input
                                        type="text"
                                        value={currentConfig.bgReplaceColor}
                                        onChange={(e) => updateCurrentConfig({ bgReplaceColor: e.target.value })}
                                        className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white outline-none"
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                    </div>
                )}

                {/* RECOLOR MODE CONTROLS */}
                {currentConfig.activeModes.includes('recolor') && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                    <div className="flex justify-between items-end">
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Recolor Rules</h3>
                    </div>
                    
                    {currentConfig.recolorPairs.map((pair, idx) => (
                        <div key={pair.id} className="p-4 bg-gray-800/50 rounded-xl border border-gray-700/50 relative">
                            <div className="flex justify-between items-center mb-3">
                                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Change #{idx + 1}</span>
                                {currentConfig.recolorPairs.length > 1 && (
                                    <button onClick={() => removeRecolorPair(pair.id)} className="text-gray-500 hover:text-red-400">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                            
                            <div className="mb-3">
                                <label className="block text-xs text-gray-400 mb-1">
                                    {useAI && apiKeyAvailable ? 'Description (e.g. "red car")' : 'Original Color'}
                                </label>
                                {useAI && apiKeyAvailable ? (
                                    <input 
                                        type="text"
                                        value={pair.objectDescription}
                                        onChange={(e) => updateRecolorPair(pair.id, 'objectDescription', e.target.value)}
                                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                                        placeholder="Object name..."
                                    />
                                ) : (
                                    <div className="flex gap-2">
                                        <input
                                            type="color"
                                            value={pair.original}
                                            onChange={(e) => updateRecolorPair(pair.id, 'original', e.target.value)}
                                            className="h-8 w-10 bg-transparent border-0 cursor-pointer rounded overflow-hidden"
                                        />
                                        <div className="text-sm flex items-center text-gray-400">
                                            Select color to change
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Target Color</label>
                                <div className="flex gap-2">
                                    <input
                                        type="color"
                                        value={pair.target}
                                        onChange={(e) => updateRecolorPair(pair.id, 'target', e.target.value)}
                                        className="h-8 w-10 bg-transparent border-0 cursor-pointer rounded overflow-hidden"
                                    />
                                    <input
                                        type="text"
                                        value={pair.target}
                                        onChange={(e) => updateRecolorPair(pair.id, 'target', e.target.value)}
                                        className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white outline-none"
                                    />
                                </div>
                            </div>
                        </div>
                    ))}
                    
                    <button 
                        onClick={addRecolorPair}
                        className="w-full py-2 border border-dashed border-gray-600 rounded-xl text-gray-400 hover:text-white hover:border-gray-500 hover:bg-gray-800/50 transition-all flex items-center justify-center gap-2 text-sm"
                    >
                        <Plus className="w-4 h-4" />
                        Add Rule
                    </button>
                    </div>
                )}

                <div className="pt-4">
                    {isGlobalMode ? (
                        <button
                            onClick={applyGlobalToAll}
                            disabled={projects.length === 0 || isProcessingAny}
                            className="w-full py-3 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all active:scale-95 text-white"
                        >
                            <Settings className="w-5 h-5" />
                            Apply Global Settings to All {projects.length} GIFs
                        </button>
                    ) : (
                        <button
                            onClick={() => activeProject && triggerProcessProject(activeProject)}
                            disabled={!activeProject || activeProject.status === ProcessingStatus.PROCESSING || activeProject.status === ProcessingStatus.ENCODING || activeProject.activeModes.length === 0}
                            className="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 rounded-xl font-semibold shadow-lg shadow-indigo-900/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all active:scale-95"
                        >
                        {activeProject?.status === ProcessingStatus.PROCESSING ? (
                            <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Processing {activeProject.progress}%
                            </>
                        ) : activeProject?.status === ProcessingStatus.ENCODING ? (
                            <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Encoding GIF...
                            </>
                        ) : (
                            <>
                            <Play className="w-5 h-5 fill-current" />
                            Apply to this GIF
                            </>
                        )}
                        </button>
                    )}
                </div>
                </div>
            </div>

            {/* Preview Area */}
            <div className="space-y-6">
                
                {/* Original Preview */}
                <div className="bg-gray-900/50 p-6 rounded-2xl border border-gray-800 backdrop-blur-sm">
                <h3 className="text-sm font-medium text-gray-400 mb-4 flex items-center gap-2">
                    <Layers className="w-4 h-4" />
                    Original First Frame
                </h3>
                <div className="relative aspect-square rounded-xl overflow-hidden bg-[url('https://media.istockphoto.com/id/1146261394/vector/checkered-flag.jpg?s=612x612&w=0&k=20&c=Lmqo_IqZ33x4kQYwXQjU8rGgq6X6q5j8y5m7n9o0p1q2')] bg-cover">
                    <div className="absolute inset-0 bg-gray-800/80 backdrop-grayscale"></div>
                    {isGlobalMode ? (
                        <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm p-4 text-center">
                            Preview available when editing a specific GIF
                        </div>
                    ) : (
                        activeProject?.frames.length && (
                        <canvas 
                            ref={(canvas) => {
                            if (canvas && activeProject.frames[0]) {
                                canvas.width = activeProject.frames[0].imageData.width;
                                canvas.height = activeProject.frames[0].imageData.height;
                                const ctx = canvas.getContext('2d');
                                ctx?.putImageData(activeProject.frames[0].imageData, 0, 0);
                            }
                            }}
                            className="relative w-full h-full object-contain"
                        />
                        )
                    )}
                </div>
                </div>

                {/* Result Preview */}
                {activeProject?.resultBlob && !isGlobalMode && (
                <div className="bg-gray-900/50 p-6 rounded-2xl border border-gray-800 backdrop-blur-sm animate-in fade-in zoom-in duration-300">
                    <h3 className="text-sm font-medium text-indigo-400 mb-4 flex items-center gap-2">
                    <ImageIcon className="w-4 h-4" />
                    Processed Result
                    </h3>
                    <div className="relative aspect-square rounded-xl overflow-hidden bg-gray-800 mb-4">
                    {/* Checkerboard background */}
                    <div className="absolute inset-0 opacity-20" style={{
                        backgroundImage: 'linear-gradient(45deg, #333 25%, transparent 25%), linear-gradient(-45deg, #333 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #333 75%), linear-gradient(-45deg, transparent 75%, #333 75%)',
                        backgroundSize: '20px 20px',
                        backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px'
                    }}></div>
                    <img 
                        src={URL.createObjectURL(activeProject.resultBlob)} 
                        alt="Processed GIF" 
                        className="relative w-full h-full object-contain z-10"
                    />
                    </div>
                    <button
                    onClick={downloadGif}
                    className="w-full py-2 bg-white text-gray-900 hover:bg-gray-100 rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors"
                    >
                    <Download className="w-4 h-4" />
                    Download Result
                    </button>
                </div>
                )}
                
                {activeProject?.error && !isGlobalMode && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                    {activeProject.error}
                </div>
                )}
            </div>
            </div>
        </div>
        )}
      </div>
    </div>
  );
};

export default GifEditor;