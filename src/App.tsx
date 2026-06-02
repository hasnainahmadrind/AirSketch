import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Undo2,
  Redo2,
  Eraser,
  Paintbrush,
  Trash2,
  Download,
  Volume2,
  VolumeX,
  Eye,
  EyeOff,
  Maximize,
  Minimize,
  Sliders,
  Grid,
  Info,
  Activity,
  Sparkles,
  Camera,
  Play,
  RotateCw,
  HelpCircle,
  Clock,
  Layers
} from 'lucide-react';
import { synth } from './utils/audio';
import { GestureType, AppStatus, Point, AppStats } from './types';

// Connection mapping for skeletal display
const SKELETON_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
  [0, 5], [5, 6], [6, 7], [7, 8], // Index
  [5, 9], [9, 10], [10, 11], [11, 12], // Middle
  [9, 13], [13, 14], [14, 15], [15, 16], // Ring
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17] // Pinky & Palm
];

// Vibrant cyber neon color palette
const COLOR_PRESETS = [
  { name: 'Neon Pink', value: '#ff007f' },
  { name: 'Cyber Blue', value: '#00f7ff' },
  { name: 'Acid Green', value: '#39ff14' },
  { name: 'Purple Plasma', value: '#b100ff' },
  { name: 'Solar Yellow', value: '#ffd700' },
  { name: 'Chalk White', value: '#ffffff' }
];

export default function App() {
  // UI & Brush States
  const [brushColor, setBrushColor] = useState('#00f7ff');
  const [brushSize, setBrushSize] = useState(8);
  const [isEraser, setIsEraser] = useState(false);
  const [webcamOpacity, setWebcamOpacity] = useState(0.5);
  const [skeletonVisible, setSkeletonVisible] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // App & Tracking status states
  const [appStatus, setAppStatus] = useState<AppStatus>('LOADING_RESOURCES');
  const [activeGesture, setActiveGesture] = useState<GestureType>('NONE');
  const [stats, setStats] = useState<AppStats>({ fps: 0, latency: 0, handsDetected: 0 });
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Mouse painting fallback state
  const [isMouseFallbackActive, setIsMouseFallbackActive] = useState(false);
  const [showTutorial, setShowTutorial] = useState(true);

  // Ref assignments
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // References for synchronized high-frequency access (eliminates stale closures)
  const brushColorRef = useRef(brushColor);
  const brushSizeRef = useRef(brushSize);
  const isEraserRef = useRef(isEraser);
  const soundEnabledRef = useRef(soundEnabled);
  const skeletonVisibleRef = useRef(skeletonVisible);

  // Drawing state tracking refs
  const historyRef = useRef<{ points: Point[]; color: string; size: number; isEraser: boolean }[]>([]);
  const redoHistoryRef = useRef<{ points: Point[]; color: string; size: number; isEraser: boolean }[]>([]);
  const currentIntervalStrokePointsRef = useRef<Point[]>([]);
  const isCurrentlyDrawingRef = useRef(false);
  const isCurrentlyErasingRef = useRef(false);

  // Gesture timing & smoothing refs
  const lastRawPointRef = useRef<{ x: number; y: number } | null>(null);
  const smoothedFingerTipRef = useRef<{ x: number; y: number } | null>(null);
  const lastActiveGestureRef = useRef<GestureType>('NONE');
  const pinchProgressRef = useRef<number>(0); // Holds progress ms of active clearing pinch

  // Performance telemetry refs
  const lastFrameTimeRef = useRef<number>(performance.now());
  const smoothedFpsRef = useRef<number>(45);

  // Mouse backup drawing refs
  const isMouseDownRef = useRef(false);

  // Synchronize dynamic parameters with React state changes
  useEffect(() => { brushColorRef.current = brushColor; }, [brushColor]);
  useEffect(() => { brushSizeRef.current = brushSize; }, [brushSize]);
  useEffect(() => { isEraserRef.current = isEraser; }, [isEraser]);
  useEffect(() => { soundEnabledRef.current = soundEnabled; }, [soundEnabled]);
  useEffect(() => { skeletonVisibleRef.current = skeletonVisible; }, [skeletonVisible]);

  // Sync fullscreen state
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  // Sync canvas size with device pixel ratio (crisp vector lines)
  const resizeCanvases = () => {
    const canvas = canvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!canvas || !overlayCanvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    overlayCanvas.width = rect.width * dpr;
    overlayCanvas.height = rect.height * dpr;

    redrawDrawingCanvas();
  };

  // Re-draws the user's vector strokes from stored path coordinates (responsive design)
  const redrawDrawingCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    historyRef.current.forEach(stroke => {
      if (stroke.points.length < 1) return;

      ctx.beginPath();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (stroke.isEraser) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = stroke.size * 1.5;
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = stroke.color;
        ctx.shadowColor = stroke.color;
        ctx.shadowBlur = Math.min(stroke.size / 2, 4); // Ambient neon glow
        ctx.lineWidth = stroke.size;
      }

      const pts = stroke.points;
      const w = canvas.width;
      const h = canvas.height;

      ctx.moveTo(pts[0].x * w, pts[0].y * h);

      if (pts.length === 1) {
        // Point dab
        ctx.lineTo(pts[0].x * w, pts[0].y * h);
      } else {
        // Quadratic curves for ultra-fluid calligraphy strokes
        for (let i = 1; i < pts.length - 1; i++) {
          const xc = (pts[i].x * w + pts[i + 1].x * w) / 2;
          const yc = (pts[i].y * h + pts[i + 1].y * h) / 2;
          ctx.quadraticCurveTo(pts[i].x * w, pts[i].y * h, xc, yc);
        }
        ctx.lineTo(pts[pts.length - 1].x * w, pts[pts.length - 1].y * h);
      }
      ctx.stroke();

      // Reset composite configuration
      ctx.globalCompositeOperation = 'source-over';
      ctx.shadowBlur = 0;
    });
  };

  // Safe undo
  const handleUndo = () => {
    if (historyRef.current.length === 0) return;
    const item = historyRef.current.pop();
    if (item) {
      redoHistoryRef.current.push(item);
      if (soundEnabledRef.current) synth.playPop();
      redrawDrawingCanvas();
    }
  };

  // Safe redo
  const handleRedo = () => {
    if (redoHistoryRef.current.length === 0) return;
    const item = redoHistoryRef.current.pop();
    if (item) {
      historyRef.current.push(item);
      if (soundEnabledRef.current) synth.playPop();
      redrawDrawingCanvas();
    }
  };

  // Clear canvas
  const handleClearCanvas = () => {
    if (historyRef.current.length === 0) return;
    historyRef.current = [];
    redoHistoryRef.current = [];
    if (soundEnabledRef.current) synth.playClear();
    redrawDrawingCanvas();
  };

  // Export as transparent PNG
  const handleSaveDrawing = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Trigger feedback sound
    if (soundEnabledRef.current) synth.playPop();

    // Export with timestamp
    const url = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `air-canvas-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`;
    link.href = url;
    link.click();
  };

  // Handle Fullscreen
  const handleFullscreenToggle = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Permission blocked (common inside iframe previews)
    }
  };

  // Sync keystrokes (Ctrl+Z and Ctrl+Y)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', resizeCanvases);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', resizeCanvases);
    };
  }, []);

  // MediaPipe core initialization
  useEffect(() => {
    let activeCamera: any = null;
    let keepCheckingMediaPipe = true;

    const startTrackingEngine = async () => {
      const { Hands, Camera } = window as any;

      // Polyfill check for loaded CDN scripts
      if (!Hands || !Camera) {
        if (keepCheckingMediaPipe) {
          setTimeout(startTrackingEngine, 100);
        }
        return;
      }

      setAppStatus('LOADING_CAMERA');

      // Initialize hands model
      const hands = new Hands({
        locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
      });

      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.65,
        minTrackingConfidence: 0.65
      });

      // Frame response handling
      hands.onResults((results: any) => {
        // Telemetry frames computing
        const now = performance.now();
        const rawFps = 1000 / (now - lastFrameTimeRef.current);
        smoothedFpsRef.current = Math.round(smoothedFpsRef.current * 0.9 + rawFps * 0.1);
        lastFrameTimeRef.current = now;

        const overlayCanvas = overlayCanvasRef.current;
        const drawingCanvas = canvasRef.current;
        if (!overlayCanvas || !drawingCanvas) return;

        const overlayCtx = overlayCanvas.getContext('2d');
        const drawingCtx = drawingCanvas.getContext('2d');
        if (!overlayCtx || !drawingCtx) return;

        // Clear display overlay
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

        // Detect Hands count
        const multiHandLandmarks = results.multiHandLandmarks || [];
        const multiHandedness = results.multiHandedness || [];
        const handsDetectedCount = multiHandLandmarks.length;

        // Sync visual stats
        let trackingLatency = 0;
        if (results.image) {
          trackingLatency = Math.round(performance.now() - now); // approximate delay
        }

        setStats({
          fps: Math.min(smoothedFpsRef.current, 60),
          latency: trackingLatency || 12,
          handsDetected: handsDetectedCount
        });

        // Set state to ready on first successful frame feedback
        setAppStatus('READY');

        // Capture canvas dimensions
        const cw = overlayCanvas.width;
        const ch = overlayCanvas.height;

        let detectedActiveGesture: GestureType = 'NONE';
        let mainHandIndexTip: { x: number; y: number } | null = null;

        // Loop over both hands to draw skeleton nodes and extract gesture inputs
        multiHandLandmarks.forEach((landmarks: any, handIndex: number) => {
          const side = multiHandedness[handIndex]?.label || 'Right'; // 'Left' or 'Right'

          // Render Hand connections & dots if toggled active
          if (skeletonVisibleRef.current) {
            // Draw bones
            overlayCtx.lineWidth = 3;
            overlayCtx.lineCap = 'round';
            overlayCtx.strokeStyle = side === 'Right' ? 'rgba(0, 247, 255, 0.45)' : 'rgba(255, 0, 127, 0.45)';

            SKELETON_CONNECTIONS.forEach(([start, end]) => {
              const pStart = landmarks[start];
              const pEnd = landmarks[end];
              if (pStart && pEnd) {
                overlayCtx.beginPath();
                // Coordinate flips to mirror feed in mirror drawing space
                overlayCtx.moveTo((1 - pStart.x) * cw, pStart.y * ch);
                overlayCtx.lineTo((1 - pEnd.x) * cw, pEnd.y * ch);
                overlayCtx.stroke();
              }
            });

            // Draw joint nodes
            landmarks.forEach((pt: any) => {
              overlayCtx.beginPath();
              overlayCtx.arc((1 - pt.x) * cw, pt.y * ch, 4, 0, 2 * Math.PI);
              overlayCtx.fillStyle = '#ffffff';
              overlayCtx.fill();
              overlayCtx.lineWidth = 1.5;
              overlayCtx.strokeStyle = side === 'Right' ? '#00f7ff' : '#ff007f';
              overlayCtx.stroke();
            });
          }

          // Evaluate geometry distances to classify gestures helper
          const dist = (p1: any, p2: any) => {
            const dx = p1.x - p2.x;
            const dy = p1.y - p2.y;
            const dz = (p1.z || 0) - (p2.z || 0);
            return Math.sqrt(dx * dx + dy * dy + dz * dz);
          };

          // Wrist point reference
          const wrist = landmarks[0];

          // Check extensions based on wrist relative radial lengths
          const isIndexExt = dist(landmarks[8], wrist) > dist(landmarks[6], wrist) * 1.15;
          const isMiddleExt = dist(landmarks[12], wrist) > dist(landmarks[10], wrist) * 1.15;
          const isRingExt = dist(landmarks[16], wrist) > dist(landmarks[14], wrist) * 1.15;
          const isPinkyExt = dist(landmarks[20], wrist) > dist(landmarks[18], wrist) * 1.15;

          // Pinch distance check (Index Tip 8 vs Thumb Tip 4)
          const isPinchingIndexThumb = dist(landmarks[8], landmarks[4]) < 0.045 && !isMiddleExt && !isRingExt;

          let gesture: GestureType = 'NONE';
          if (isPinchingIndexThumb) {
            gesture = 'PINCH_CLEAR';
          } else if (isIndexExt && !isMiddleExt && !isRingExt && !isPinkyExt) {
            gesture = 'DRAW';
          } else if (!isIndexExt && !isMiddleExt && !isRingExt && !isPinkyExt) {
            gesture = 'ERASE'; // Fist
          } else if (isIndexExt && isMiddleExt && isRingExt && isPinkyExt) {
            gesture = 'HOVER'; // Open Palm
          }

          // Assign priority to drawing hand actions
          if (handIndex === 0 || detectedActiveGesture === 'NONE' || detectedActiveGesture === 'HOVER') {
            detectedActiveGesture = gesture;
            // Record index finger coordinate
            mainHandIndexTip = { x: 1 - landmarks[8].x, y: landmarks[8].y };

            // For pinch-to-clear, place target in the center between index tip and thumb tip
            if (gesture === 'PINCH_CLEAR') {
              mainHandIndexTip = {
                x: 1 - (landmarks[8].x + landmarks[4].x) / 2,
                y: (landmarks[8].y + landmarks[4].y) / 2
              };
            }
          }
        });

        // Match backup mouse state as a fallback
        if (handsDetectedCount === 0 && isMouseFallbackActive) {
          // If no physical hand exists, preserve stats overlay but bypass loop
          setStats(prev => ({ ...prev, handsDetected: 0 }));
          return;
        }

        setActiveGesture(detectedActiveGesture);

        // Update drawing / erasing pipelines
        if (mainHandIndexTip) {
          const ptRaw = mainHandIndexTip;

          // Interpolation filtering to prevent tracking jitter
          if (!smoothedFingerTipRef.current) {
            smoothedFingerTipRef.current = { ...ptRaw };
          } else {
            // High efficiency exponential smoothing filter
            smoothedFingerTipRef.current = {
              x: smoothedFingerTipRef.current.x * 0.6 + ptRaw.x * 0.4,
              y: smoothedFingerTipRef.current.y * 0.6 + ptRaw.y * 0.4
            };
          }

          const curSmooth = smoothedFingerTipRef.current;

          // Gesture state machine pipelines
          if ((detectedActiveGesture as string) === 'DRAW') {
            // Draw state init trigger
            if (!isCurrentlyDrawingRef.current) {
              isCurrentlyDrawingRef.current = true;
              isCurrentlyErasingRef.current = false;
              currentIntervalStrokePointsRef.current = [];
              if (soundEnabledRef.current) synth.playDrawStart();
            }

            const activePt: Point = {
              x: curSmooth.x,
              y: curSmooth.y,
              color: brushColorRef.current,
              size: brushSizeRef.current,
              isEraser: false,
              isStart: currentIntervalStrokePointsRef.current.length === 0
            };

            currentIntervalStrokePointsRef.current.push(activePt);

            // Incremental canvas bridge
            const pts = currentIntervalStrokePointsRef.current;
            if (pts.length >= 2) {
              const p1 = pts[pts.length - 2];
              const p2 = pts[pts.length - 1];
              drawingCtx.beginPath();
              drawingCtx.lineCap = 'round';
              drawingCtx.lineJoin = 'round';
              drawingCtx.globalCompositeOperation = 'source-over';
              drawingCtx.strokeStyle = brushColorRef.current;
              drawingCtx.lineWidth = brushSizeRef.current;
              drawingCtx.moveTo(p1.x * cw, p1.y * ch);
              drawingCtx.lineTo(p2.x * cw, p2.y * ch);
              drawingCtx.stroke();
            }

            // Draw sleeker cyber target pointer dot
            overlayCtx.beginPath();
            overlayCtx.arc(curSmooth.x * cw, curSmooth.y * ch, brushSizeRef.current / 2 + 6, 0, 2 * Math.PI);
            overlayCtx.strokeStyle = brushColorRef.current;
            overlayCtx.lineWidth = 1.5;
            overlayCtx.stroke();

            overlayCtx.beginPath();
            overlayCtx.arc(curSmooth.x * cw, curSmooth.y * ch, 3, 0, 2 * Math.PI);
            overlayCtx.fillStyle = brushColorRef.current;
            overlayCtx.fill();

          } else if ((detectedActiveGesture as string) === 'ERASE') {
            // Erase state init trigger
            if (!isCurrentlyErasingRef.current) {
              isCurrentlyErasingRef.current = true;
              isCurrentlyDrawingRef.current = false;
              currentIntervalStrokePointsRef.current = [];
              if (soundEnabledRef.current) synth.playErase();
            }

            const activePt: Point = {
              x: curSmooth.x,
              y: curSmooth.y,
              color: '#000000',
              size: brushSizeRef.current * 1.5,
              isEraser: true,
              isStart: currentIntervalStrokePointsRef.current.length === 0
            };

            currentIntervalStrokePointsRef.current.push(activePt);

            const pts = currentIntervalStrokePointsRef.current;
            if (pts.length >= 2) {
              const p1 = pts[pts.length - 2];
              const p2 = pts[pts.length - 1];
              drawingCtx.beginPath();
              drawingCtx.lineCap = 'round';
              drawingCtx.lineJoin = 'round';
              drawingCtx.globalCompositeOperation = 'destination-out';
              drawingCtx.lineWidth = brushSizeRef.current * 2.2; // Extra width for eraser efficiency
              drawingCtx.moveTo(p1.x * cw, p1.y * ch);
              drawingCtx.lineTo(p2.x * cw, p2.y * ch);
              drawingCtx.stroke();
              drawingCtx.globalCompositeOperation = 'source-over'; // safety reset
            }

            // Draw glowing pink danger target around eraser tip
            overlayCtx.beginPath();
            overlayCtx.arc(curSmooth.x * cw, curSmooth.y * ch, brushSizeRef.current, 0, 2 * Math.PI);
            overlayCtx.strokeStyle = '#ff007f';
            overlayCtx.lineWidth = 2;
            overlayCtx.setLineDash([4, 4]);
            overlayCtx.stroke();
            overlayCtx.setLineDash([]); // clear dash

          } else if ((detectedActiveGesture as string) === 'PINCH_CLEAR') {
            // Accumulate clearing pinch frames
            // 30 FPS estimate uses approx 33ms steps, adjusted to performance frame ratios
            const lastFrameDelay = Math.max(now - lastFrameTimeRef.current, 16);
            pinchProgressRef.current = Math.min(pinchProgressRef.current + lastFrameDelay * 1.8, 1500);

            const progressRatio = pinchProgressRef.current / 1500;

            // Draw beautiful radar HUD charging sweep visual around the pinch epicenter
            overlayCtx.beginPath();
            overlayCtx.arc(curSmooth.x * cw, curSmooth.y * ch, 32, 0, 2 * Math.PI);
            overlayCtx.strokeStyle = 'rgba(255,255,255,0.15)';
            overlayCtx.lineWidth = 4;
            overlayCtx.stroke();

            overlayCtx.beginPath();
            overlayCtx.arc(curSmooth.x * cw, curSmooth.y * ch, 32, -Math.PI / 2, -Math.PI / 2 + progressRatio * 2 * Math.PI);
            overlayCtx.strokeStyle = '#39ff14';
            overlayCtx.lineWidth = 5;
            overlayCtx.stroke();

            overlayCtx.fillStyle = '#ffffff';
            overlayCtx.font = 'bold 11px Inter, sans-serif';
            overlayCtx.textAlign = 'center';
            overlayCtx.fillText(`${Math.round(progressRatio * 100)}%`, curSmooth.x * cw, curSmooth.y * ch + 4);

            if (progressRatio >= 1.0) {
              // Trigger clearing confirmation lock
              historyRef.current = [];
              redoHistoryRef.current = [];
              pinchProgressRef.current = 0;
              if (soundEnabledRef.current) synth.playClear();
              drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);

              // Flash drawing canvas feedback
              overlayCtx.fillStyle = 'rgba(255, 255, 255, 0.45)';
              overlayCtx.fillRect(0, 0, cw, ch);
            }
          } else {
            // Idle hover pointer targets
            pinchProgressRef.current = 0; // reset pinch timers

            // Commit pending paint stroke to memory history
            if (isCurrentlyDrawingRef.current || isCurrentlyErasingRef.current) {
              if (currentIntervalStrokePointsRef.current.length > 0) {
                historyRef.current.push({
                  points: [...currentIntervalStrokePointsRef.current],
                  color: isCurrentlyErasingRef.current ? '#000000' : brushColorRef.current,
                  size: brushSizeRef.current,
                  isEraser: isCurrentlyErasingRef.current
                });
                redoHistoryRef.current = []; // break redo chain
                if (soundEnabledRef.current) synth.playPop();
              }
              isCurrentlyDrawingRef.current = false;
              isCurrentlyErasingRef.current = false;
              currentIntervalStrokePointsRef.current = [];
            }

            // Draw non-drawing tracking dot
            overlayCtx.beginPath();
            overlayCtx.arc(curSmooth.x * cw, curSmooth.y * ch, 6, 0, 2 * Math.PI);
            overlayCtx.fillStyle = 'rgba(255, 255, 255, 0.6)';
            overlayCtx.fill();
            overlayCtx.strokeStyle = '#ffffff';
            overlayCtx.lineWidth = 1;
            overlayCtx.stroke();
          }

          lastActiveGestureRef.current = detectedActiveGesture;
        } else {
          // If hand left tracking region, commit final stroke
          pinchProgressRef.current = 0;
          if (isCurrentlyDrawingRef.current || isCurrentlyErasingRef.current) {
            if (currentIntervalStrokePointsRef.current.length > 0) {
              historyRef.current.push({
                points: [...currentIntervalStrokePointsRef.current],
                color: isCurrentlyErasingRef.current ? '#000000' : brushColorRef.current,
                size: brushSizeRef.current,
                isEraser: isCurrentlyErasingRef.current
              });
              redoHistoryRef.current = [];
              if (soundEnabledRef.current) synth.playPop();
            }
            isCurrentlyDrawingRef.current = false;
            isCurrentlyErasingRef.current = false;
            currentIntervalStrokePointsRef.current = [];
          }
          smoothedFingerTipRef.current = null;
        }
      });

      // Bind local video node and launch MediaPipe camera utils loop
      const videoElement = videoRef.current;
      if (videoElement) {
        try {
          activeCamera = new Camera(videoElement, {
            onFrame: async () => {
              if (videoElement) {
                await hands.send({ image: videoElement });
              }
            },
            width: 1280,
            height: 720
          });

          await activeCamera.start();
          setAppStatus('READY');
          resizeCanvases();
        } catch (err: any) {
          console.warn("Camera hardware access missed, engaging interactive fallbacks:", err);
          setCameraError(err?.message || "Webcam not found or permissions blocked.");
          setAppStatus('READY'); // Render fallback canvas interactivity
          setIsMouseFallbackActive(true);
          resizeCanvases();
        }
      }
    };

    startTrackingEngine();

    return () => {
      keepCheckingMediaPipe = false;
      if (activeCamera) {
        try {
          activeCamera.stop();
        } catch (e) {
          console.warn("Camera cleanup warning:", e);
        }
      }
    };
  }, []);

  // Delay initial layout resize to ensure React mounting is fully stabilized
  useEffect(() => {
    const timer = setTimeout(() => {
      resizeCanvases();
    }, 500);
    return () => clearTimeout(timer);
  }, [appStatus]);

  // Back-up backup drawing for mouse and touch interactions (webcam failing fallback)
  const handleMouseDrawStart = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isMouseFallbackActive) return;
    isMouseDownRef.current = true;
    currentIntervalStrokePointsRef.current = [];
    if (soundEnabled) synth.playDrawStart();

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    const pt: Point = {
      x, y,
      color: brushColor,
      size: brushSize,
      isEraser,
      isStart: true
    };
    currentIntervalStrokePointsRef.current.push(pt);
  };

  const handleMouseDrawMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isMouseFallbackActive || !isMouseDownRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    const pt: Point = {
      x, y,
      color: brushColor,
      size: brushSize,
      isEraser,
      isStart: false
    };

    currentIntervalStrokePointsRef.current.push(pt);

    const pts = currentIntervalStrokePointsRef.current;
    const p1 = pts[pts.length - 2];
    const p2 = pts[pts.length - 1];

    ctx.beginPath();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (isEraser) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = brushSize * 1.5;
      ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
      ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
      ctx.stroke();
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = brushColor;
      ctx.lineWidth = brushSize;
      ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
      ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
      ctx.stroke();
    }
  };

  const handleMouseDrawEnd = () => {
    if (!isMouseFallbackActive || !isMouseDownRef.current) return;
    isMouseDownRef.current = false;
    if (currentIntervalStrokePointsRef.current.length > 0) {
      historyRef.current.push({
        points: [...currentIntervalStrokePointsRef.current],
        color: isEraser ? '#000000' : brushColor,
        size: brushSize,
        isEraser: isEraser
      });
      redoHistoryRef.current = [];
      if (soundEnabled) synth.playPop();
    }
    currentIntervalStrokePointsRef.current = [];
  };

  return (
    <div className="relative w-full h-screen overflow-hidden bg-zinc-950 font-sans text-zinc-100 select-none">
      {/* Background Webcam Feed */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover scale-x-[-1] pointer-events-none transition-opacity duration-300"
        style={{ opacity: webcamOpacity }}
        playsInline
        muted
      />

      {/* Sophisticated Dark background micro dot patterns & ambient radial vignette */}
      <div className="absolute inset-0 bg-radial-gradient(circle_at_center,_rgba(24,24,27,0.34)_0%,_rgba(9,9,11,1)_100%) pointer-events-none" />
      <div className="absolute inset-0 opacity-15 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#3f3f46 1px, transparent 1px)', backgroundSize: '32px 32px' }} />

      {/* Drawing Canvas Overlay */}
      <canvas
        ref={canvasRef}
        id="drawing-canvas"
        className={`absolute inset-0 w-full h-full z-10 ${isMouseFallbackActive ? 'cursor-crosshair pointer-events-auto' : 'pointer-events-none'}`}
        onMouseDown={handleMouseDrawStart}
        onMouseMove={handleMouseDrawMove}
        onMouseUp={handleMouseDrawEnd}
        onMouseLeave={handleMouseDrawEnd}
      />

      {/* Hand Skeleton Connection HUD Overlay Canvas */}
      <canvas
        ref={overlayCanvasRef}
        id="skeleton-hud-canvas"
        className="absolute inset-0 w-full h-full z-20 pointer-events-none"
      />

      {/* Dynamic Header System HUD (Top Floating) */}
      <div className="absolute top-4 left-4 right-4 z-30 flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center pointer-events-auto">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 backdrop-blur-xl bg-zinc-900/60 border border-white/10 px-4 py-2.5 rounded-xl shadow-2xl"
        >
          <div className="relative flex h-3.5 w-3.5">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isMouseFallbackActive ? 'bg-amber-400' : 'bg-cyan-400'}`}></span>
            <span className={`relative inline-flex rounded-full h-3.5 w-3.5 ${isMouseFallbackActive ? 'bg-amber-500' : 'bg-cyan-500'}`}></span>
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold tracking-tight text-white uppercase leading-none">Neural Canvas</span>
            <span className="text-[9px] font-mono tracking-widest text-cyan-400 font-bold uppercase mt-1">
              {isMouseFallbackActive ? 'Manual Sandbox Mode' : 'Hand-Tracking Subsystem Active'}
            </span>
          </div>
        </motion.div>

        {/* Dynamic Mode Display Badge */}
        <div className="flex gap-2">
          {/* Active Gesture readout */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeGesture}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold leading-none tracking-wider uppercase shadow-md border 
                ${activeGesture === 'DRAW' ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400 shadow-cyan-500/10' : ''}
                ${activeGesture === 'ERASE' ? 'bg-pink-500/10 border-pink-500/30 text-pink-400 shadow-pink-500/10' : ''}
                ${activeGesture === 'PINCH_CLEAR' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-emerald-500/10' : ''}
                ${activeGesture === 'HOVER' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 shadow-amber-500/10' : ''}
                ${activeGesture === 'NONE' ? 'bg-zinc-900/60 border-white/10 text-zinc-400' : ''}
              `}
            >
              {activeGesture === 'DRAW' && (
                <>
                  <Paintbrush className="w-4 h-4 animate-pulse" />
                  <span>Drawing Air Pen</span>
                </>
              )}
              {activeGesture === 'ERASE' && (
                <>
                  <Eraser className="w-4 h-4 animate-bounce" />
                  <span>Air Eraser Mode</span>
                </>
              )}
              {activeGesture === 'PINCH_CLEAR' && (
                <>
                  <Trash2 className="w-4 h-4 animate-spin text-emerald-400" />
                  <span>Clearing Whiteboard</span>
                </>
              )}
              {activeGesture === 'HOVER' && (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Air Cursor Hover</span>
                </>
              )}
              {activeGesture === 'NONE' && (
                <>
                  <Clock className="w-3.5 h-3.5" />
                  <span>{isMouseFallbackActive ? "Mouse Drawing Ready" : "Position Hand in Frame"}</span>
                </>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Quick diagnostic hardware widget */}
          <div className="hidden sm:flex items-center gap-4 py-2 px-4 rounded-xl text-xs font-mono bg-zinc-900/60 backdrop-blur-xl border border-white/10 shadow-lg text-zinc-300">
            <span className="flex items-center gap-1.5 border-r border-zinc-800 pr-3.5">
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
              <span>FPS: {stats.fps}</span>
            </span>
            <span className="flex items-center gap-1.5 border-r border-zinc-800 pr-3.5">
              <span>LATENCY: {stats.latency}ms</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span>HANDS: {stats.handsDetected}</span>
            </span>
          </div>
        </div>
      </div>

      {/* Floating Left Control Console (Futuristic Glassmorphic Deck) */}
      <motion.div
        initial={{ opacity: 0, x: -30 }}
        animate={{ opacity: 1, x: 0 }}
        className="absolute left-4 top-24 bottom-24 w-80 z-30 flex flex-col gap-4 pointer-events-auto"
      >
        <div className="flex-1 flex flex-col backdrop-blur-xl bg-zinc-900/60 border border-white/10 rounded-2xl shadow-2xl p-4 overflow-y-auto custom-scrollbar">
          {/* Logo & Info Header */}
          <div className="flex items-center justify-between border-b border-white/10 pb-3.5 mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 bg-cyan-500 rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.5)] text-black">
                <Sparkles className="w-5 h-5" />
              </div>
              <div className="flex flex-col">
                <h1 className="text-xs font-bold tracking-tight text-white uppercase leading-none">Neural Paint</h1>
                <span className="text-[9px] font-mono tracking-wider text-cyan-400 uppercase mt-0.5">Control Interface</span>
              </div>
            </div>
            <button
              onClick={() => setShowTutorial(true)}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-cyan-400 hover:bg-white/5 transition-colors"
              title="Show gesture guide"
            >
              <HelpCircle className="w-4.5 h-4.5" />
            </button>
          </div>

          {/* Fallback mouse switch notification */}
          {isMouseFallbackActive && (
            <div className="bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-xl p-3 mb-4 text-xs">
              <div className="flex gap-2 items-start">
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
                <p className="leading-relaxed">
                  <strong>Mouse Sandbox Active:</strong> Camera feed is offline/denied. Drag your mouse or cursor directly on screen to paint lines!
                </p>
              </div>
              {!cameraError && (
                <button
                  onClick={() => setIsMouseFallbackActive(false)}
                  className="mt-2.5 w-full py-1.5 bg-amber-500/20 border border-amber-500/30 text-amber-300 hover:bg-amber-500/30 transition-colors font-semibold text-[10px] rounded-lg uppercase tracking-wide cursor-pointer"
                >
                  Force Retrack Camera
                </button>
              )}
            </div>
          )}

          {/* Mode selections (Brush / Eraser) */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            <button
              onClick={() => {
                setIsEraser(false);
                if (soundEnabled) synth.playPop();
              }}
              className={`flex items-center justify-center gap-2 py-3 rounded-xl border text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer
                ${!isEraser
                  ? 'bg-cyan-500 text-black border-transparent shadow-lg shadow-cyan-500/20 font-bold'
                  : 'bg-zinc-950/40 border-zinc-800 text-zinc-400 hover:bg-white/5 hover:text-zinc-200'}`}
            >
              <Paintbrush className="w-4 h-4" />
              <span>Brush</span>
            </button>
            <button
              onClick={() => {
                setIsEraser(true);
                if (soundEnabled) synth.playPop();
              }}
              className={`flex items-center justify-center gap-2 py-3 rounded-xl border text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer
                ${isEraser
                  ? 'bg-cyan-500 text-black border-transparent shadow-lg shadow-cyan-500/20 font-bold'
                  : 'bg-zinc-950/40 border-zinc-800 text-zinc-400 hover:bg-white/5 hover:text-zinc-200'}`}
            >
              <Eraser className="w-4 h-4" />
              <span>Eraser</span>
            </button>
          </div>

          {/* Color Palettes Section */}
          <div className="mb-4">
            <h2 className="text-[10px] font-mono tracking-widest uppercase text-zinc-500 mb-2.5">Palette Colors</h2>
            <div className="grid grid-cols-6 gap-2">
              {COLOR_PRESETS.map((color) => (
                <button
                  key={color.name}
                  onClick={() => {
                    setBrushColor(color.value);
                    setIsEraser(false);
                    if (soundEnabled) synth.playPop();
                  }}
                  className={`relative aspect-square rounded-lg transition-all transform hover:scale-105 shadow-sm active:scale-95 cursor-pointer`}
                  style={{
                    backgroundColor: color.value,
                    boxShadow: brushColor === color.value && !isEraser ? `0 0 12px ${color.value}80` : 'none',
                    border: brushColor === color.value && !isEraser ? '2px solid #ffffff' : '1px solid rgba(255,255,255,0.1)'
                  }}
                  title={color.name}
                />
              ))}
            </div>

            {/* Custom Color Input */}
            <div className="mt-3.5 flex items-center justify-between gap-3 bg-zinc-950/40 border border-white/10 rounded-xl px-3 py-2">
              <span className="text-xs text-zinc-400">Custom Color:</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-medium text-zinc-350 uppercase select-all">{brushColor}</span>
                <input
                  type="color"
                  value={brushColor}
                  onChange={(e) => {
                    setBrushColor(e.target.value);
                    setIsEraser(false);
                  }}
                  className="w-8 h-8 rounded-lg outline-none border-0 overflow-hidden cursor-pointer bg-transparent"
                />
              </div>
            </div>
          </div>

          {/* Dynamic Brush Size Slider */}
          <div className="mb-4 bg-zinc-950/40 border border-white/10 rounded-xl p-3.5">
            <div className="flex justify-between items-center mb-2.5">
              <span className="text-xs font-semibold text-zinc-300 uppercase">Brush Size</span>
              <span className="text-xs font-mono bg-zinc-900 border border-zinc-800 text-cyan-400 px-2 py-0.5 rounded-md leading-none">
                {brushSize}px
              </span>
            </div>
            <input
              type="range"
              min="2"
              max="60"
              value={brushSize}
              onChange={(e) => setBrushSize(parseInt(e.target.value))}
              className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
            />
          </div>

          <div className="mt-auto pt-4 border-t border-white/10 space-y-4">
            {/* Webcam video Opacity leveler */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] font-mono tracking-wide uppercase text-zinc-500">Webcam Feed Contrast</span>
                <span className="text-xs font-mono text-zinc-300">{Math.round(webcamOpacity * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={webcamOpacity * 100}
                onChange={(e) => setWebcamOpacity(parseFloat(e.target.value) / 100)}
                className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
              />
            </div>

            {/* Quick manual triggers */}
            <div className="flex items-center gap-1.5 justify-between">
              <span className="text-xs text-zinc-500 font-mono">Preferences:</span>
              <div className="flex gap-1.5">
                {/* Audio feedback checkbox */}
                <button
                  onClick={() => {
                    setSoundEnabled(!soundEnabled);
                  }}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                    soundEnabled
                      ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400 shadow-sm'
                      : 'bg-zinc-950/40 border-zinc-800 text-zinc-400 hover:text-zinc-300 hover:bg-white/5'
                  }`}
                  title={soundEnabled ? "Disable UI sounds" : "Enable UI sounds"}
                >
                  {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                </button>

                {/* Hand Skeleton helper toggle */}
                {!isMouseFallbackActive && (
                  <button
                    onClick={() => {
                      setSkeletonVisible(!skeletonVisible);
                      if (soundEnabled) synth.playPop();
                    }}
                    className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                      skeletonVisible
                        ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400 shadow-sm'
                        : 'bg-zinc-950/40 border-zinc-800 text-zinc-400 hover:text-zinc-300 hover:bg-white/5'
                    }`}
                    title={skeletonVisible ? "Hide hand skeleton tracking" : "Show hand skeleton tracking"}
                  >
                    {skeletonVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                )}

                {/* Mouse mode slider toggle */}
                <button
                  onClick={() => {
                    setIsMouseFallbackActive(!isMouseFallbackActive);
                    if (soundEnabled) synth.playPop();
                  }}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                    isMouseFallbackActive
                      ? 'bg-amber-500/10 border-amber-500/35 text-amber-400 shadow-sm'
                      : 'bg-zinc-950/40 border-zinc-800 text-zinc-400 hover:text-zinc-300 hover:bg-white/5'
                  }`}
                  title="Toggle mouse painting sandbox"
                >
                  <Layers className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Floating Bottom Control Hub Deck */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="absolute bottom-4 left-4 right-4 z-30 flex justify-center pointer-events-none"
      >
        <div className="flex flex-wrap sm:flex-nowrap items-center justify-between sm:justify-start gap-4 p-3 backdrop-blur-xl bg-zinc-900/60 border border-white/10 rounded-2xl shadow-2xl pointer-events-auto">
          {/* Active Canvas Action Group */}
          <div className="flex items-center gap-1.5 border-r border-white/10 pr-3 sm:pr-4">
            <button
              onClick={handleUndo}
              className="p-3 rounded-xl bg-zinc-950/40 hover:bg-white/5 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-cyan-400 active:scale-95 transition-all cursor-pointer"
              title="Undo stroke (Ctrl+Z)"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              onClick={handleRedo}
              className="p-3 rounded-xl bg-zinc-950/40 hover:bg-white/5 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-cyan-400 active:scale-95 transition-all cursor-pointer"
              title="Redo stroke (Ctrl+Y)"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </div>

          {/* Clearing / exporting buttons */}
          <div className="flex items-center gap-1.5 flex-1 justify-center">
            <button
              onClick={handleClearCanvas}
              className="flex items-center gap-2 px-6 py-3 bg-zinc-900/80 text-white border border-zinc-700 font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-zinc-800 transition-all cursor-pointer"
            >
              <Trash2 className="w-4 h-4 text-zinc-400" />
              <span className="hidden sm:inline">Clear Canvas</span>
            </button>
            <button
              onClick={handleSaveDrawing}
              className="flex items-center gap-2 px-8 py-3 bg-zinc-100 text-black font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-white transition-all shadow-xl cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Save Image</span>
            </button>
          </div>

          {/* Fullscreen widget separator */}
          <div className="flex items-center gap-1.5 border-l border-white/10 pl-3 sm:pl-4">
            <button
              onClick={handleFullscreenToggle}
              className="p-3 rounded-xl bg-zinc-950/40 hover:bg-white/5 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-cyan-400 transition-all cursor-pointer"
              title="Toggle Fullscreen"
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </motion.div>

      {/* Futuristic Interactive Loading & Setup overlay */}
      {appStatus !== 'READY' && (
        <div className="absolute inset-0 z-50 flex flex-col justify-center items-center bg-zinc-950 backdrop-blur-xl text-zinc-100 animate-fade-in">
          <div className="max-w-md w-full px-6 text-center space-y-6">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
              className="w-12 h-12 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full mx-auto shadow-[0_0_15px_rgba(6,182,212,0.3)]"
            />
            <div className="space-y-2">
              <h1 className="text-lg font-mono tracking-widest text-zinc-100 uppercase">Booting Neural Canvas</h1>
              <p className="text-xs text-cyan-400 font-mono tracking-wider animate-pulse uppercase">
                {appStatus === 'LOADING_RESOURCES' ? 'Sourcing MediaPipe algorithms...' : 'Opening Webcam channel...'}
              </p>
            </div>

            <div className="bg-zinc-900/60 border border-white/10 text-left p-4 rounded-2xl font-mono text-xs text-zinc-400 space-y-2.5 shadow-2xl">
              <div className="flex justify-between items-center">
                <span>[MODULE] WebAssembly engine:</span>
                <span className="text-emerald-400 font-bold uppercase">Online</span>
              </div>
              <div className="flex justify-between items-center">
                <span>[ASSETS] MediaPipe neural model:</span>
                <span className={appStatus !== 'LOADING_RESOURCES' ? 'text-emerald-400 font-bold uppercase' : 'text-cyan-500 tracking-wide animate-pulse uppercase'}>
                  {appStatus !== 'LOADING_RESOURCES' ? 'Loaded' : 'Awaiting...'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span>[CLIENT] Local video device:</span>
                <span className={appStatus === 'READY' ? 'text-emerald-400 font-bold uppercase' : 'text-cyan-500 tracking-wide animate-pulse uppercase'}>
                  {appStatus === 'READY' ? 'Acquired' : 'Calibrating...'}
                </span>
              </div>
            </div>

            <div className="text-[10px] text-zinc-500 font-mono leading-relaxed max-w-sm mx-auto uppercase tracking-wide">
              Please grant camera permission when prompted. If no camera is available or access is blocked, a manual mouse-pad blackboard will run.
            </div>
          </div>
        </div>
      )}

      {/* Interactive Modal Tutorial Backdrop */}
      <AnimatePresence>
        {showTutorial && (
          <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-xl z-50 flex items-center justify-center p-4 text-zinc-100">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-900/95 border border-white/10 max-w-xl w-full rounded-2xl shadow-2xl p-6 overflow-hidden relative"
            >
              {/* Background gradient accents */}
              <div className="absolute top-0 right-0 w-48 h-48 bg-cyan-500/5 blur-3xl pointer-events-none rounded-full" />
              <div className="absolute bottom-0 left-0 w-48 h-48 bg-pink-500/5 blur-3xl pointer-events-none rounded-full" />

              <div className="flex items-center gap-2.5 mb-4 border-b border-white/10 pb-3">
                <Sparkles className="w-5 h-5 text-cyan-400" />
                <h3 className="text-base font-bold text-zinc-100 uppercase tracking-wide">Getting Started with Neural Canvas</h3>
              </div>

              <p className="text-xs text-zinc-350 leading-relaxed mb-6">
                Welcome to a zero-contact gesture-based painting suite. You can draw lines by slicing the air in front of your camera. Our lightweight model tracks your knuckles and fingertips to paint smooth anti-aliased digital artwork!
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mb-6">
                <div className="flex gap-3 bg-zinc-950/50 border border-white/10 p-3 rounded-xl animate-fade-in">
                  <div className="text-2xl mt-0.5 select-none text-cyan-400">☝️</div>
                  <div className="space-y-0.5">
                    <h4 className="text-xs font-bold text-zinc-200 uppercase tracking-wide">Index Finger Raised</h4>
                    <p className="text-[10px] text-zinc-400 leading-normal">
                      <strong>DRAWING MODE:</strong> Draw lines dynamically matching your finger position. Lift your finger to stop.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 bg-zinc-950/50 border border-white/10 p-3 rounded-xl animate-fade-in">
                  <div className="text-2xl mt-0.5 select-none text-pink-400">✊</div>
                  <div className="space-y-0.5">
                    <h4 className="text-xs font-bold text-zinc-200 uppercase tracking-wide">Closed Fist</h4>
                    <p className="text-[10px] text-zinc-400 leading-normal">
                      <strong>ERASER MODE:</strong> Erase previous lines from the board by placing your fist over them.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 bg-zinc-950/50 border border-white/10 p-3 rounded-xl animate-fade-in">
                  <div className="text-2xl mt-0.5 select-none text-amber-400">🖐️</div>
                  <div className="space-y-0.5">
                    <h4 className="text-xs font-bold text-zinc-200 uppercase tracking-wide">Open Palm</h4>
                    <p className="text-[10px] text-zinc-400 leading-normal">
                      <strong>HOVER / IDLE:</strong> Pause active drawing. Move your hand to see the virtual cursor with no lines left.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 bg-zinc-950/50 border border-white/10 p-3 rounded-xl animate-fade-in">
                  <div className="text-2xl mt-0.5 select-none text-emerald-400">🤏</div>
                  <div className="space-y-0.5">
                    <h4 className="text-xs font-bold text-zinc-200 uppercase tracking-wide">Thumb + Index Pinch</h4>
                    <p className="text-[10px] text-zinc-400 leading-normal">
                      <strong>PINCH TO CLEAR:</strong> Hold index and thumb together for 1.5 seconds to wipe out your board immediately.
                    </p>
                  </div>
                </div>
              </div>

              {cameraError && (
                <div className="bg-rose-500/10 border border-rose-500/20 text-rose-300 rounded-xl p-3 mb-6 text-xs flex gap-2">
                  <Info className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-bold uppercase tracking-wide text-rose-200">Webcam connection skipped:</p>
                    <p>{cameraError}</p>
                    <p className="text-[10px] text-rose-400 uppercase tracking-wider">You are automatically standard routed to Mouse Fallback sandbox!</p>
                  </div>
                </div>
              )}

              <button
                onClick={() => setShowTutorial(false)}
                className="w-full py-3.5 text-xs font-bold uppercase tracking-widest bg-zinc-100 hover:bg-white text-zinc-950 active:scale-99 transition-all rounded-xl shadow-xl cursor-pointer"
              >
                Let&apos;s Calibration and Begin!
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
