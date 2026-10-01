import { useEffect, useState } from 'react';
import { Box, Skeleton } from '@mui/material';
import QR from 'qrcode';

/** Renders a QR code locally in the browser: the token never leaves the page. */
export function QRCode({ value, size = 220 }: { value: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QR.toDataURL(value, { errorCorrectionLevel: 'M', margin: 1, width: size * 2 })
      .then((u) => alive && setSrc(u))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [value, size]);
  if (!src) return <Skeleton variant="rectangular" width={size} height={size} />;
  return <Box component="img" src={src} alt="Entry QR code" width={size} height={size} sx={{ display: 'block', imageRendering: 'pixelated', bgcolor: '#fff' }} />;
}
