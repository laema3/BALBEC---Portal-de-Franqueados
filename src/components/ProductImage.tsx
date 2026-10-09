import React from 'react';
import { useStore } from '../store/useStore';

interface ProductImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  containerClassName?: string;
}

export const ProductImage: React.FC<ProductImageProps> = ({ 
  src, 
  alt, 
  className = "w-full h-full object-cover rounded-2xl",
  containerClassName = "w-full h-full flex items-center justify-center overflow-hidden rounded-2xl"
}) => {
  const storeLogo = useStore(state => state.storeInfo.logoUrl);
  const logoUrl = storeLogo || '/logo.svg';
  
  // Check if src is valid and not an empty placeholder
  const isValidSrc = Boolean(src && typeof src === 'string' && src.trim() !== '' && !src.includes('unsplash.com'));
  
  // Transform insecure HTTP URLs or BlueFocus URLs into secure backend proxy URLs
  let finalSrc = src || '';
  if (isValidSrc && src) {
    if (src.startsWith('data:') || src.startsWith('/')) {
      finalSrc = src;
    } else if (src.startsWith('http://') || src.includes('static/mercadoria') || src.includes('ddns.net') || src.includes(':8082')) {
      finalSrc = `/api/image-proxy?url=${encodeURIComponent(src)}`;
    }
  }
  
  const [error, setError] = React.useState(false);
  const [logoError, setLogoError] = React.useState(false);

  React.useEffect(() => {
    setError(false);
  }, [src]);

  const handleError = () => {
    setError(true);
  };

  if (!isValidSrc || error) {
    if (!logoError) {
      return (
        <div className={`${containerClassName} bg-stone-900/5`}>
          <img 
            src={logoUrl} 
            alt={alt || "Logo BALBEC"} 
            className="w-full h-full object-contain p-2 group-hover:scale-105 transition-transform duration-500"
            referrerPolicy="no-referrer"
            onError={() => {
              setLogoError(true);
            }}
          />
        </div>
      );
    }
    
    return (
      <div className={`${containerClassName} bg-stone-950 p-2`}>
        <img 
          src="/logo.svg" 
          alt="BALBEC" 
          className="w-full h-full object-contain"
        />
      </div>
    );
  }

  return (
    <div className={containerClassName}>
      <img 
        src={finalSrc!} 
        alt={alt} 
        className={className}
        onError={handleError}
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    </div>
  );
};

