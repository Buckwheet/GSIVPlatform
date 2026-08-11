export interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  radius?: string | number;
  variant?: "text" | "circle" | "bar" | "block";
  lines?: number;
  style?: React.CSSProperties;
  className?: string;
}

export function Skeleton({
  width,
  height,
  radius,
  variant = "block",
  lines = 1,
  style,
  className = "",
}: SkeletonProps) {
  const getStyle = (isLine = false) => {
    const combinedStyle: React.CSSProperties = { ...style };
    if (width !== undefined) combinedStyle.width = typeof width === "number" ? `${width}px` : width;
    if (height !== undefined && !isLine) combinedStyle.height = typeof height === "number" ? `${height}px` : height;
    if (radius !== undefined) combinedStyle.borderRadius = typeof radius === "number" ? `${radius}px` : radius;
    return combinedStyle;
  };

  if (variant === "text" && lines > 1) {
    return (
      <div
        className={`gs-skeleton-text-group${className ? ` ${className}` : ""}`}
        role="status"
        aria-busy="true"
        aria-hidden="true"
        style={style}
      >
        {Array.from({ length: lines }).map((_, i) => {
          // Make the last line slightly shorter for natural text look
          const isLast = i === lines - 1;
          const lineWidth = isLast ? "75%" : "100%";
          return (
            <span
              key={i}
              className="gs-skeleton gs-skeleton--text"
              style={{ ...getStyle(true), width: width !== undefined ? undefined : lineWidth }}
            />
          );
        })}
      </div>
    );
  }

  return (
    <span
      className={`gs-skeleton gs-skeleton--${variant}${className ? ` ${className}` : ""}`}
      style={getStyle()}
      role="status"
      aria-busy="true"
      aria-hidden="true"
    />
  );
}

