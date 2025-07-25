import React from 'react';

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
}

const GlassCard: React.FC<GlassCardProps> = ({ children, className = '', ...props }) => {
  return (
    <div
      className={`bg-white/10 backdrop-blur-lg rounded-2xl border border-white/10 shadow-lg p-4 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};

export default GlassCard; 