import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import jsQR from 'jsqr';

interface Props {
  onScan: (text: string) => void;
  /** While true the camera keeps running but decoded codes are ignored (e.g. result screen is showing). */
  paused?: boolean;
}

/** Camera QR scanner (getUserMedia + jsQR). Same code is ignored for 3s to avoid double submits. */
export function Scanner({ onScan, paused }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const pausedRef = useRef(paused);
  const onScanRef = useRef(onScan);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  pausedRef.current = paused;
  onScanRef.current = onScan;

  useEffect(() => {
    let stream: MediaStream | undefined;
    let raf = 0;
    let stopped = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera access needs a secure (https) connection. Use the Search tab instead.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
      } catch {
        setError('Camera permission was denied or no camera was found. Use the Search tab to check guests in by name.');
        return;
      }
      if (stopped || !video.current) return;
      setError(null);
      video.current.srcObject = stream;
      await video.current.play().catch(() => undefined);
      const tick = () => {
        raf = requestAnimationFrame(tick);
        const v = video.current;
        const c = canvas.current;
        if (!v || !c || v.readyState < 2 || pausedRef.current) return;
        const w = Math.min(v.videoWidth, 640);
        const h = Math.round((v.videoHeight / v.videoWidth) * w);
        if (!w || !h) return;
        c.width = w;
        c.height = h;
        const g = c.getContext('2d', { willReadFrequently: true });
        if (!g) return;
        g.drawImage(v, 0, 0, w, h);
        const code = jsQR(g.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
        if (code?.data) {
          const now = Date.now();
          if (code.data === last.current.text && now - last.current.at < 3000) return;
          last.current = { text: code.data, at: now };
          onScanRef.current(code.data);
        }
      };
      tick();
    }
    void start();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [attempt]);

  if (error) {
    return (
      <Alert severity="warning" action={<Button color="inherit" size="small" onClick={() => setAttempt((a) => a + 1)}>Try again</Button>}>
        {error}
      </Alert>
    );
  }
  return (
    <Stack gap={1} alignItems="center">
      <Box sx={{ position: 'relative', width: '100%', maxWidth: 480, aspectRatio: '1 / 1', bgcolor: '#000', borderRadius: 3, overflow: 'hidden' }}>
        <video ref={video} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} aria-label="Camera preview" />
        <Box sx={{ position: 'absolute', inset: '18%', border: '3px solid rgba(255,255,255,0.85)', borderRadius: 3, pointerEvents: 'none' }} />
        <canvas ref={canvas} hidden />
      </Box>
      <Typography variant="body2" color="text.secondary">Point the camera at a guest's QR code</Typography>
    </Stack>
  );
}
