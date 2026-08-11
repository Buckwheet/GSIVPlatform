import React, { useState } from "react";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  render?: (row: T) => React.ReactNode;
  align?: "left" | "right" | "center";
  width?: string | number;
  sortable?: boolean;
}

export interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  ariaLabel: string;
  density?: "comfortable" | "compact";
  stickyHeader?: boolean;
  maxHeight?: string;
  onRowClick?: (row: T) => void;
  emptyState?: React.ReactNode;
  loading?: boolean; // show skeleton rows while data loads
  // Optional sorting props if pages use them
  sortKey?: string;
  sortDirection?: "asc" | "desc";
  onSort?: (key: string) => void;
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  ariaLabel,
  density,
  stickyHeader = false,
  maxHeight,
  onRowClick,
  emptyState = "No data available",
  loading = false,
  sortKey,
  sortDirection,
  onSort,
}: TableProps<T>) {
  const [localSortKey, setLocalSortKey] = useState<string | undefined>(sortKey);
  const [localSortDirection, setLocalSortDirection] = useState<"asc" | "desc" | undefined>(sortDirection);

  const handleHeaderClick = (column: Column<T>) => {
    if (!column.sortable) return;
    
    if (onSort) {
      onSort(column.key);
    } else {
      // Internal simple toggle fallback
      const isCurrent = localSortKey === column.key;
      const nextDir = isCurrent && localSortDirection === "asc" ? "desc" : "asc";
      setLocalSortKey(column.key);
      setLocalSortDirection(nextDir);
    }
  };

  // Get active sort details
  const activeSortKey = onSort ? sortKey : localSortKey;
  const activeSortDir = onSort ? sortDirection : localSortDirection;

  // Internal sorting if no external onSort is provided
  const processedRows = React.useMemo(() => {
    if (onSort || !activeSortKey) return rows;
    
    const sorted = [...rows];
    sorted.sort((a: any, b: any) => {
      const valA = a[activeSortKey];
      const valB = b[activeSortKey];
      
      if (valA == null) return 1;
      if (valB == null) return -1;
      
      if (typeof valA === "number" && typeof valB === "number") {
        return activeSortDir === "asc" ? valA - valB : valB - valA;
      }
      
      const strA = String(valA).toLowerCase();
      const strB = String(valB).toLowerCase();
      
      if (strA < strB) return activeSortDir === "asc" ? -1 : 1;
      if (strA > strB) return activeSortDir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [rows, activeSortKey, activeSortDir, onSort]);

  const handleRowKeyDown = (e: React.KeyboardEvent, row: T) => {
    if (onRowClick && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onRowClick(row);
    }
  };

  const tableElement = (
    <table className={`gs-table${density ? ` gs-table--${density}` : ""}`} aria-label={ariaLabel} aria-busy={loading}>
      <thead>
        <tr>
          {columns.map((col) => {
            const alignClass = col.align ? ` gs-table__th--align-${col.align}` : "";
            const widthStyle = col.width ? { width: typeof col.width === "number" ? `${col.width}px` : col.width } : undefined;
            const isSorted = activeSortKey === col.key;
            
            return (
              <th
                key={col.key}
                scope="col"
                style={widthStyle}
                className={`gs-table__th${alignClass}${col.sortable ? " gs-table__th--sortable" : ""}`}
              >
                {col.sortable ? (
                  <button
                    type="button"
                    className="gs-table__sort-btn"
                    onClick={() => handleHeaderClick(col)}
                    aria-label={`Sort by ${String(col.header)} ${isSorted && activeSortDir === "asc" ? "descending" : "ascending"}`}
                  >
                    <span>{col.header}</span>
                    <span className="gs-table__sort-indicator" aria-hidden="true">
                      {isSorted ? (activeSortDir === "asc" ? " ▴" : " ▾") : " ↕"}
                    </span>
                  </button>
                ) : (
                  col.header
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {loading ? (
          Array.from({ length: 5 }).map((_, r) => (
            <tr key={r} className="gs-table__row" aria-hidden="true">
              {columns.map((col) => (
                <td key={col.key} className="gs-table__td">
                  <span
                    className="gs-skeleton gs-skeleton--bar"
                    style={{ width: r === 0 && col.key === columns[0].key ? "40%" : "90%", height: 14, display: "inline-block" }}
                  />
                </td>
              ))}
            </tr>
          ))
        ) : processedRows.length === 0 ? (
          <tr>
            <td colSpan={columns.length} className="gs-table__empty-cell">
              <div className="gs-table__empty-state">{emptyState}</div>
            </td>
          </tr>
        ) : (
          processedRows.map((row, idx) => {
            const key = rowKey(row, idx);
            const isClickable = !!onRowClick;
            
            return (
              <tr
                key={key}
                className={`gs-table__row${isClickable ? " gs-table__row--interactive" : ""}`}
                onClick={isClickable ? () => onRowClick(row) : undefined}
                onKeyDown={isClickable ? (e) => handleRowKeyDown(e, row) : undefined}
                tabIndex={isClickable ? 0 : undefined}
                role={isClickable ? "button" : undefined}
              >
                {columns.map((col) => {
                  const alignClass = col.align ? ` gs-table__td--align-${col.align}` : "";
                  const content = col.render ? col.render(row) : (row as any)[col.key];
                  
                  return (
                    <td key={col.key} className={`gs-table__td${alignClass}`}>
                      {content}
                    </td>
                  );
                })}
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );

  if (stickyHeader || maxHeight) {
    return (
      <div
        className={`gs-table-container${stickyHeader ? " gs-table-container--sticky" : ""}`}
        style={maxHeight ? { maxHeight } : undefined}
      >
        {tableElement}
      </div>
    );
  }

  return tableElement;
}
