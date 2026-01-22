'use client';

import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icons in Next.js
if (typeof window !== 'undefined') {
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  });
}

interface Checkpoint {
  id: string;
  title: string;
  lat: number | null;
  lng: number | null;
  order_index: number;
  isCompleted?: boolean;
  isCurrent?: boolean;
}

interface MapViewProps {
  checkpoints: Checkpoint[];
  center?: [number, number];
  zoom?: number;
}

function MapController({ center, zoom }: { center?: [number, number]; zoom?: number }) {
  const map = useMap();
  
  useEffect(() => {
    if (center) {
      map.setView(center, zoom || 13);
    }
  }, [map, center, zoom]);

  return null;
}

export default function MapView({ checkpoints, center, zoom = 13 }: MapViewProps) {
  const defaultCenter: [number, number] = center || [19.2433, 73.1356]; // Kalyan coordinates

  const getMarkerColor = (checkpoint: Checkpoint) => {
    if (checkpoint.isCompleted) return 'green';
    if (checkpoint.isCurrent) return 'blue';
    return 'gray';
  };

  const createCustomIcon = (color: string) => {
    return L.divIcon({
      className: 'custom-marker',
      html: `<div style="background-color: ${color}; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
  };

  return (
    <div className="w-full h-full rounded-lg overflow-hidden border-2 border-gray-200">
      <MapContainer
        center={defaultCenter}
        zoom={zoom}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapController center={center} zoom={zoom} />
        {checkpoints.map((checkpoint) => {
          if (!checkpoint.lat || !checkpoint.lng) return null;
          return (
            <Marker
              key={checkpoint.id}
              position={[checkpoint.lat, checkpoint.lng]}
              icon={createCustomIcon(getMarkerColor(checkpoint))}
            >
              <Popup>
                <div className="text-center">
                  <p className="font-semibold">{checkpoint.title}</p>
                  <p className="text-sm text-gray-600">Checkpoint {checkpoint.order_index}</p>
                  {checkpoint.isCompleted && (
                    <p className="text-xs text-green-600 mt-1">✓ Completed</p>
                  )}
                  {checkpoint.isCurrent && (
                    <p className="text-xs text-blue-600 mt-1">📍 Current</p>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
