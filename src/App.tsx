import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Play, 
  Square, 
  RotateCcw, 
  MapPin, 
  Navigation, 
  DollarSign, 
  Zap, 
  Route, 
  Clock, 
  Pause, 
  Info,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

interface Position {
  latitude: number;
  longitude: number;
  timestamp: number;
}

interface TripData {
  distance: number;
  cost: number;
  waitingTime: number;
  isRunning: boolean;
  isPaused: boolean;
  rawDistance: number; // Distancia sin descuentos para mostrar en debug
}

interface TripType {
  id: string;
  name: string;
  description: string;
  fixedPrice?: number;
  distanceKm?: number;
  subTrips?: SubTrip[];
}

interface SubTrip {
  id: string;
  name: string;
  fixedPrice: number;
}

interface TripSummary {
  tripType: string;
  distance: number;
  waitingTime: number;
  cost: number;
  timestamp: string;
  isSorianaActive: boolean;
  isFeriaActive: boolean;
  petConfig: PetConfig;
  servicioEspecialConfig: ServicioEspecialConfig;
  personasExtrasConfig: PersonasExtrasConfig;
  numeroParadas: number;
  costoParadas: number;
}

interface PetConfig {
  active: boolean;
  withCage: boolean | null;
  cost: number;
}

interface ServicioEspecialConfig {
  active: boolean;
  type: 'recoger' | 'comprar' | null;
  cost: number;
}

interface PersonasExtrasConfig {
  active: boolean;
  ninos: number;
  adultos: number;
  cost: number;
}
// Configuración de tarifas
const RATES = {
  baseFare: 50,
  waitingRate: 3, // MXN por minuto
  distanceRates: [
    { min: 0, max: 3.99, price: 50 },
    { min: 4, max: 4.99, price: 55 },
    { min: 5, max: 5.99, price: 60 },
    { min: 6, max: 6.99, price: 65 },
    { min: 7, max: 7.99, price: 70 },
    { min: 8, max: Infinity, basePrice: 80, extraRate: 16 }
  ]
};

// Tipos de viaje
const TRIP_TYPES: TripType[] = [
  {
    id: 'normal',
    name: 'Viaje Normal',
    description: 'Tarifa por distancia recorrida'
  },
  {
    id: 'walmart',
    name: 'A Walmart',
    description: 'Centro → Walmart Ciudad Guzmán',
    distanceKm: 5.2,
    fixedPrice: 60
  },
  {
    id: 'tecnologico',
    name: 'Al Tecnológico',
    description: 'Centro → Tecnológico de Ciudad Guzmán',
    distanceKm: 5.9,
    fixedPrice: 70
  },
  {
    id: 'cristoRey',
    name: 'Cristo Rey',
    description: 'Centro → Cristo Rey',
    subTrips: [
      {
        id: 'cristoRey-cano',
        name: 'Caño',
        fixedPrice: 60
      },
      {
        id: 'cristoRey-mitad',
        name: 'Mitad',
        fixedPrice: 70
      },
      {
        id: 'cristoRey-arriba',
        name: 'Arriba',
        fixedPrice: 80
      }
    ]
  }
];

// Zonas de Soriana ($70 MXN) en orden alfabético
const SORIANA_ZONES = [
  'Américas',
  'Col. San José',
  'Emiliano Zapata',
  'Las Garzas',
  'Las Lomas',
  'Pueblos de Jalisco',
  'Valle de Zapotlan'
].sort();


// Función para calcular distancia entre dos puntos GPS (fórmula Haversine)
const calculateDistance = (pos1: Position, pos2: Position): number => {
  // Fórmula de Vincenty - Mucho más precisa para distancias cortas
  // Parámetros del elipsoide WGS84
  const a = 6378137; // Semi-eje mayor en metros
  const b = 6356752.314245; // Semi-eje menor en metros
  const f = 1 / 298.257223563; // Aplanamiento
  
  const lat1 = pos1.latitude * Math.PI / 180;
  const lat2 = pos2.latitude * Math.PI / 180;
  const deltaLon = (pos2.longitude - pos1.longitude) * Math.PI / 180;
  
  const L = deltaLon;
  const U1 = Math.atan((1 - f) * Math.tan(lat1));
  const U2 = Math.atan((1 - f) * Math.tan(lat2));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);
  
  let lambda = L;
  let lambdaP;
  let iterLimit = 100;
  let cosSqAlpha, sinSigma, cos2SigmaM, cosSigma, sigma;
  
  do {
    const sinLambda = Math.sin(lambda);
    const cosLambda = Math.cos(lambda);
    sinSigma = Math.sqrt((cosU2 * sinLambda) * (cosU2 * sinLambda) +
      (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) * (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda));
    
    if (sinSigma === 0) return 0; // Puntos coincidentes
    
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = cosU1 * cosU2 * sinLambda / sinSigma;
    cosSqAlpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cosSigma - 2 * sinU1 * sinU2 / cosSqAlpha;
    
    if (isNaN(cos2SigmaM)) cos2SigmaM = 0; // Línea ecuatorial
    
    const C = f / 16 * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
    lambdaP = lambda;
    lambda = L + (1 - C) * f * sinAlpha *
      (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
  } while (Math.abs(lambda - lambdaP) > 1e-12 && --iterLimit > 0);
  
  if (iterLimit === 0) {
    // Fallback a fórmula más simple si no converge
    const R = 6371000;
    const dLat = (pos2.latitude - pos1.latitude) * Math.PI / 180;
    const dLon = (pos2.longitude - pos1.longitude) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(pos1.latitude * Math.PI / 180) * Math.cos(pos2.latitude * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }
  
  const uSq = cosSqAlpha * (a * a - b * b) / (b * b);
  const A = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const B = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma = B * sinSigma * (cos2SigmaM + B / 4 * (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
    B / 6 * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));
  
  const distance = b * A * (sigma - deltaSigma);
  
  // Factor de corrección reducido ya que Vincenty es más preciso
  // Solo un pequeño ajuste para compensar el filtrado del GPS móvil
  const correctionFactor = 1.15; // Reducido del 40% al 15%
  
  return distance * correctionFactor;
};

// Componente principal de la aplicación
function App() {
  const [tripData, setTripData] = useState<TripData>({
    distance: 0,
    cost: RATES.baseFare,
    waitingTime: 0,
    isRunning: false,
    isPaused: false,
    rawDistance: 0
  });

  const [currentPosition, setCurrentPosition] = useState<Position | null>(null);
  const [watchId, setWatchId] = useState<number | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'requesting' | 'available' | 'denied' | 'unavailable'>('requesting');
  const [selectedTripType, setSelectedTripType] = useState<TripType>(TRIP_TYPES[0]);
  const [selectedSubTrip, setSelectedSubTrip] = useState<SubTrip | null>(null);
  const [showTripTypeSelector, setShowTripTypeSelector] = useState(false);
  const [showSubTripSelector, setShowSubTripSelector] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [lastTripSummary, setLastTripSummary] = useState<TripSummary | null>(null);
  const [showRates, setShowRates] = useState(false);
  const [currentAddress, setCurrentAddress] = useState<string>('');
  const [googleMapsReady, setGoogleMapsReady] = useState(false);
  const [totalWaitingTime, setTotalWaitingTime] = useState(0);
  const [showExtrasSelector, setShowExtrasSelector] = useState(false);
  const [serviciosExtrasActive, setServiciosExtrasActive] = useState(false);
  const [showPetSelector, setShowPetSelector] = useState(false);
  const [petConfig, setPetConfig] = useState<PetConfig>({
    active: false,
    withCage: null,
    cost: 0
  });
  const [showServicioEspecialSelector, setShowServicioEspecialSelector] = useState(false);
  const [servicioEspecialConfig, setServicioEspecialConfig] = useState<ServicioEspecialConfig>({
    active: false,
    type: null,
    cost: 0
  });
  const [showFinalizarParada, setShowFinalizarParada] = useState(false);
  const [costoAcumuladoParadas, setCostoAcumuladoParadas] = useState(0);
  const [numeroParadas, setNumeroParadas] = useState(0);
  const [showPersonasExtrasSelector, setShowPersonasExtrasSelector] = useState(false);
  const [personasExtrasConfig, setPersonasExtrasConfig] = useState<PersonasExtrasConfig>({
    active: false,
    ninos: 0,
    adultos: 0,
    cost: 0
  });

  // Estado para el check de Soriana
  const [isSorianaActive, setIsSorianaActive] = useState(false);
  const [selectedSorianaZone, setSelectedSorianaZone] = useState<string | null>(null);

  // Estado para el check de Feria
  const [isFeriaActive, setIsFeriaActive] = useState(false);

  // Estado para la simulación
  const [isSimulating, setIsSimulating] = useState(false);
  const simulationInterval = useRef<NodeJS.Timeout | null>(null);

  // Referencias para mantener estado en callbacks
  const isActiveRef = useRef(false);
  const lastPositionRef = useRef<Position | null>(null);
  const waitingStartTime = useRef<number | null>(null);
  const waitingInterval = useRef<NodeJS.Timeout | null>(null);

  // Función para calcular la tarifa
  const getBasePrice = (tripType: TripType): number => {
    if (selectedSubTrip && tripType.id === 'cristoRey') {
      return selectedSubTrip.fixedPrice;
    }
    // Si Feria está activo, el costo base es $60
    if (isFeriaActive) {
      return 60;
    }
    return tripType.fixedPrice || RATES.baseFare;
  };

  // Función para calcular la tarifa
  const calculateFare = useCallback((distanceKm: number, waitingMinutes: number, sorianaBonus: boolean = false) => {
    // Si Soriana está activo Y se seleccionó una zona, el costo es fijo de $70 MXN
    if (sorianaBonus && selectedSorianaZone) {
      const petExtraFee = petConfig.active ? petConfig.cost : 0;
      const servicioEspecialFee = servicioEspecialConfig.active ? servicioEspecialConfig.cost : 0;
      const personasExtrasFee = personasExtrasConfig.active ? personasExtrasConfig.cost : 0;

      return costoAcumuladoParadas + 70 + (waitingMinutes * RATES.waitingRate) + petExtraFee + servicioEspecialFee + personasExtrasFee;
    }

    // Calcular costo adicional de mascotas
    const petExtraFee = petConfig.active ? petConfig.cost : 0;

    // Calcular costo adicional de servicio especial
    const servicioEspecialFee = servicioEspecialConfig.active ? servicioEspecialConfig.cost : 0;

    // Calcular costo adicional de personas extras
    const personasExtrasFee = personasExtrasConfig.active ? personasExtrasConfig.cost : 0;

    // Calcular extra de $5 MXN para viajes diferentes al normal después de 3.7 km
    // O si Soriana está activo sin zona seleccionada
    const tripTypeExtraFee = ((selectedTripType.id !== 'normal' || (sorianaBonus && !selectedSorianaZone)) && distanceKm >= 3.7) ? 5 : 0;

    // Determinar el precio base según el tipo de viaje
    let baseFareToUse = (selectedTripType.id === 'cristoRey' && selectedSubTrip)
      ? selectedSubTrip.fixedPrice
      : (selectedTripType.fixedPrice || RATES.baseFare);

    // Si Feria está activo, el costo base es $60
    if (isFeriaActive) {
      baseFareToUse = 60;
    }

    // Cálculo por distancia usando el precio base correspondiente
    let fare = baseFareToUse;

    for (const rate of RATES.distanceRates) {
      if (distanceKm >= rate.min && distanceKm <= rate.max) {
        if (rate.extraRate && distanceKm > 8) {
          const extraKm = distanceKm - 8;
          const adjustedBasePrice = (rate.basePrice! - RATES.baseFare) + baseFareToUse;
          fare = adjustedBasePrice + (extraKm * rate.extraRate);
        } else {
          const priceIncrease = rate.price! - RATES.baseFare;
          fare = baseFareToUse + priceIncrease;
        }
        break;
      }
    }

    return costoAcumuladoParadas + fare + (waitingMinutes * RATES.waitingRate) + petExtraFee + servicioEspecialFee + personasExtrasFee + tripTypeExtraFee;
  }, [selectedTripType, selectedSubTrip, petConfig, servicioEspecialConfig, personasExtrasConfig, costoAcumuladoParadas, selectedSorianaZone, isFeriaActive]);

  // Formatear tiempo
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Manejar nueva posición GPS
  const handlePositionUpdate = useCallback((position: Position) => {
    setCurrentPosition(position);
    setGpsStatus('available');

    // Verificamos la referencia 'en vivo' del estado activo
    if (isActiveRef.current && !tripData.isPaused) {
      if (lastPositionRef.current) {
        // La distancia se calcula en metros para mayor precisión.
        const newDistanceMeters = calculateDistance(lastPositionRef.current, position);
        
        // Umbral más alto para filtrar mejor el "ruido" GPS y evitar cálculos prematuros
        const THRESHOLD = 15; // Aumentado de 5 a 15 metros
        if (newDistanceMeters > THRESHOLD) {
          // Convertimos a km para sumar al total
          const newDistanceKm = newDistanceMeters / 1000;
          setTripData(prev => {
            const rawTotalDistance = prev.rawDistance + newDistanceKm;
            
            // Aplicar descuento de 0.125 km por cada kilómetro completado
            const completedKm = Math.floor(rawTotalDistance);
            const discount = completedKm * 0.125;
            const adjustedDistance = Math.max(0, rawTotalDistance - discount);
            
            const waitingMinutes = Math.floor(prev.waitingTime / 60);
            return {
              ...prev,
              rawDistance: rawTotalDistance,
              distance: adjustedDistance,
              cost: calculateFare(adjustedDistance, waitingMinutes, isSorianaActive)
            };
          });
          // SOLO actualizar la última posición cuando realmente se registra movimiento
          lastPositionRef.current = position;
        }
      } else {
        // Primera posición después de iniciar - establecer como punto de referencia
        lastPositionRef.current = position;
      }
    }
  }, [calculateFare, tripData.isPaused, isSorianaActive]);

  // Inicializar GPS
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const position: Position = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            timestamp: Date.now()
          };
          setCurrentPosition(position);
          lastPositionRef.current = position;
          setGpsStatus('available');
        },
        (error) => {
          if (error.code === error.PERMISSION_DENIED) {
            setGpsStatus('denied');
          } else {
            setGpsStatus('unavailable');
          }
        },
        { enableHighAccuracy: true }
      );
    } else {
      setGpsStatus('unavailable');
    }
  }, []);

  // Iniciar contador de tiempo de espera
  const startWaitingTimer = () => {
    waitingStartTime.current = Date.now();
    waitingInterval.current = setInterval(() => {
      if (waitingStartTime.current) {
        const elapsed = Math.floor((Date.now() - waitingStartTime.current) / 1000);
        const currentWaitingTime = totalWaitingTime + elapsed;
        setTripData(prev => ({
          ...prev,
          waitingTime: currentWaitingTime
        }));
      }
    }, 1000);
  };

  // Detener contador de tiempo de espera
  const stopWaitingTimer = () => {
    if (waitingInterval.current) {
      clearInterval(waitingInterval.current);
      waitingInterval.current = null;
    }
    
    // Acumular el tiempo de espera cuando se detiene el timer
    if (waitingStartTime.current) {
      const elapsed = Math.floor((Date.now() - waitingStartTime.current) / 1000);
      setTotalWaitingTime(prev => prev + elapsed);
    }
    
    waitingStartTime.current = null;
  };

  // Iniciar taxímetro
  const startTrip = () => {
    if (currentPosition) {
      isActiveRef.current = true;
      // NO establecer lastPositionRef aquí - se establecerá en la primera actualización
      lastPositionRef.current = null;
      
      // Resetear tiempo de espera acumulado
      setTotalWaitingTime(0);
      
      setTripData(prev => ({
        ...prev,
        distance: 0, // Asegurar que siempre inicie en 0
        rawDistance: 0, // También resetear distancia cruda
        waitingTime: 0,
        isRunning: true,
        isPaused: false
      }));

      const id = navigator.geolocation.watchPosition(
        (pos) => {
          const position: Position = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            timestamp: Date.now()
          };
          handlePositionUpdate(position);
        },
        (error) => console.error('GPS Error:', error),
        {
          enableHighAccuracy: true,
          maximumAge: 500,
          timeout: 10000
        }
      );
      setWatchId(id);
    }
  };

  // Pausar/Reanudar taxímetro
  const togglePause = () => {
    setTripData(prev => {
      const newPaused = !prev.isPaused;
      
      if (newPaused) {
        // Pausar - iniciar contador de espera
        startWaitingTimer();
      } else {
        // Reanudar - detener contador de espera
        stopWaitingTimer();
      }
      
      return {
        ...prev,
        isPaused: newPaused
      };
    });
  };

  // Detener taxímetro
  const stopTrip = () => {
    if (watchId) {
      navigator.geolocation.clearWatch(watchId);
      setWatchId(null);
    }

    stopWaitingTimer();
    
    // Crear resumen del viaje (capturar estado de extras antes de resetear)
    const summary: TripSummary = {
      tripType: selectedTripType.name,
      distance: tripData.distance,
      waitingTime: tripData.waitingTime,
      cost: tripData.cost,
      timestamp: new Date().toLocaleString(),
      isSorianaActive: isSorianaActive,
      isFeriaActive: isFeriaActive,
      petConfig: { ...petConfig },
      servicioEspecialConfig: { ...servicioEspecialConfig },
      personasExtrasConfig: { ...personasExtrasConfig },
      numeroParadas: numeroParadas,
      costoParadas: costoAcumuladoParadas
    };
    
    setLastTripSummary(summary);
    setShowSummary(true);
    
    // Resetear datos del viaje
    isActiveRef.current = false;
    setTotalWaitingTime(0);
    setTripData({
      distance: 0,
      rawDistance: 0,
      cost: selectedTripType.fixedPrice || RATES.baseFare,
      waitingTime: 0,
      isRunning: false,
      isPaused: false
    });

    // Resetear extras
    setServiciosExtrasActive(false);
    setPetConfig({
      active: false,
      withCage: null,
      cost: 0
    });
    setServicioEspecialConfig({
      active: false,
      type: null,
      cost: 0
    });
    setPersonasExtrasConfig({
      active: false,
      ninos: 0,
      adultos: 0,
      cost: 0
    });
    setIsSorianaActive(false);
    setSelectedSorianaZone(null);
    setIsFeriaActive(false);
    setCostoAcumuladoParadas(0);
    setNumeroParadas(0);

    lastPositionRef.current = currentPosition;
  };

  // Función para iniciar/detener simulación
  const toggleSimulation = () => {
    if (isSimulating) {
      if (simulationInterval.current) {
        clearInterval(simulationInterval.current);
        simulationInterval.current = null;
      }
      setIsSimulating(false);
    } else {
      setIsSimulating(true);
      simulationInterval.current = setInterval(() => {
        setTripData(prev => {
          const newDistance = prev.distance + 0.1;
          const waitingMinutes = Math.floor(prev.waitingTime / 60);
          return {
            ...prev,
            distance: newDistance,
            rawDistance: newDistance,
            cost: calculateFare(newDistance, waitingMinutes, isSorianaActive)
          };
        });
      }, 1000);
    }
  };

  // Limpiar simulación al desmontar
  useEffect(() => {
    return () => {
      if (simulationInterval.current) {
        clearInterval(simulationInterval.current);
      }
    };
  }, []);

  // Efecto para actualizar el costo cuando cambia el tipo de viaje (solo si no está corriendo)
  useEffect(() => {
    if (!tripData.isRunning) {
      setTripData(prev => ({
        ...prev,
        cost: getBasePrice(selectedTripType)
      }));
    }
  }, [selectedTripType, selectedSubTrip, tripData.isRunning, isFeriaActive]);

  // Efecto para actualizar el costo cuando cambia el tiempo de espera
  useEffect(() => {
    if (tripData.isRunning) {
      const waitingMinutes = Math.floor(tripData.waitingTime / 60);
      setTripData(prev => ({
        ...prev,
        cost: calculateFare(prev.distance, waitingMinutes, isSorianaActive)
      }));
    }
  }, [calculateFare, tripData.waitingTime, tripData.isRunning, isSorianaActive]);


  // Funciones de estado
  const getStatusColor = () => {
    if (tripData.isRunning) {
      return tripData.isPaused ? 'bg-yellow-400' : 'bg-green-400';
    }
    return gpsStatus === 'available' ? 'bg-blue-400' : 'bg-red-400';
  };

  const getStatusText = () => {
    if (tripData.isRunning) {
      return tripData.isPaused ? 'PAUSADO - TIEMPO DE ESPERA' : 'VIAJE EN CURSO';
    }
    switch (gpsStatus) {
      case 'available': return 'GPS LISTO';
      case 'requesting': return 'CONECTANDO GPS...';
      case 'denied': return 'GPS DENEGADO';
      case 'unavailable': return 'GPS NO DISPONIBLE';
      default: return 'ESTADO DESCONOCIDO';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 p-4">
      <div className="max-w-md mx-auto">
        {/* Modal de resumen del viaje */}
        {showSummary && lastTripSummary && (
          <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4">
            <div className="bg-gradient-to-br from-gray-900 to-black border border-yellow-400 rounded-xl p-6 max-w-sm w-full shadow-2xl">
              <div className="flex items-center justify-center mb-4">
                <Zap className="w-8 h-8 text-yellow-400 mr-2" />
                <h2 className="text-2xl font-bold text-center text-white">
                  Resumen del Viaje
                </h2>
              </div>
              
              <div className="space-y-4">
                <div className="bg-gray-800 border border-gray-700 p-3 rounded-lg">
                  <div className="text-center">
                    <span className="text-yellow-400 font-bold text-lg">{lastTripSummary.tripType}</span>
                  </div>
                </div>

                <div className="bg-gray-800 border border-gray-700 p-4 rounded-lg">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-gray-300">Distancia recorrida:</span>
                    <span className="font-bold text-lg text-yellow-400">{lastTripSummary.distance.toFixed(3)} km</span>
                  </div>

                  <div className="flex justify-between items-center mb-2">
                    <span className="text-gray-300">Tiempo de espera:</span>
                    <span className="font-bold text-lg text-yellow-400">{formatTime(lastTripSummary.waitingTime)}</span>
                  </div>

                  <div className="border-t border-gray-600 pt-3 mt-3">
                    <div className="space-y-2 mb-2">
                      {(() => {
                        const waitingMinutes = Math.floor(lastTripSummary.waitingTime / 60);
                        const waitingCost = waitingMinutes * RATES.waitingRate;
                        const petCost = lastTripSummary.petConfig.active ? lastTripSummary.petConfig.cost : 0;
                        const servicioEspecialCost = lastTripSummary.servicioEspecialConfig.active ? lastTripSummary.servicioEspecialConfig.cost : 0;

                        // Si es zona lejana de Soriana, el costo es fijo de $70
                        // Calculamos el costo esperado sin Soriana para detectar si había zona
                        let baseFareCheck = (selectedTripType.id === 'cristoRey' && selectedSubTrip)
                          ? selectedSubTrip.fixedPrice
                          : (selectedTripType.fixedPrice || RATES.baseFare);

                        if (lastTripSummary.isFeriaActive) {
                          baseFareCheck = 60;
                        }

                        let expectedCostWithoutSoriana = baseFareCheck;
                        for (const rate of RATES.distanceRates) {
                          if (lastTripSummary.distance >= rate.min && lastTripSummary.distance <= rate.max) {
                            if (rate.extraRate && lastTripSummary.distance > 8) {
                              const extraKm = lastTripSummary.distance - 8;
                              const adjustedBasePrice = (rate.basePrice! - RATES.baseFare) + baseFareCheck;
                              expectedCostWithoutSoriana = adjustedBasePrice + (extraKm * rate.extraRate);
                            } else {
                              const priceIncrease = rate.price! - RATES.baseFare;
                              expectedCostWithoutSoriana = baseFareCheck + priceIncrease;
                            }
                            break;
                          }
                        }

                        const tripTypeExtra = (selectedTripType.id !== 'normal' && lastTripSummary.distance >= 3.7) ? 5 : 0;
                        expectedCostWithoutSoriana += tripTypeExtra + lastTripSummary.costoParadas + waitingCost + petCost + servicioEspecialCost;

                        const hadSorianaZone = lastTripSummary.isSorianaActive &&
                          Math.abs(lastTripSummary.cost - (70 + lastTripSummary.costoParadas + waitingCost + petCost + servicioEspecialCost + (lastTripSummary.personasExtrasConfig.active ? lastTripSummary.personasExtrasConfig.cost : 0))) < 1;

                        if (hadSorianaZone) {
                          return (
                            <>
                              {lastTripSummary.numeroParadas > 0 && (
                                <div className="flex justify-between items-center text-sm bg-blue-900/30 p-2 rounded">
                                  <span className="text-blue-300">Paradas intermedias ({lastTripSummary.numeroParadas} x $50):</span>
                                  <span className="text-white font-semibold">${lastTripSummary.costoParadas} MXN</span>
                                </div>
                              )}
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-300">🏪 Zona lejana (costo fijo):</span>
                                <span className="text-white font-semibold">$70 MXN</span>
                              </div>
                              {waitingCost > 0 && (
                                <div className="flex justify-between items-center text-sm">
                                  <span className="text-gray-300">Tiempo de espera:</span>
                                  <span className="text-white font-semibold">${waitingCost.toFixed(0)} MXN</span>
                                </div>
                              )}
                              {petCost > 0 && (
                                <div className="flex justify-between items-center text-sm">
                                  <span className="text-gray-300">🐕 Transporte mascota:</span>
                                  <span className="text-white font-semibold">${petCost} MXN</span>
                                </div>
                              )}
                              {servicioEspecialCost > 0 && (
                                <div className="flex justify-between items-center text-sm">
                                  <span className="text-gray-300">⭐ Servicio especial:</span>
                                  <span className="text-white font-semibold">${servicioEspecialCost} MXN</span>
                                </div>
                              )}
                              {lastTripSummary.personasExtrasConfig.active && lastTripSummary.personasExtrasConfig.cost > 0 && (
                                <div className="flex justify-between items-center text-sm">
                                  <span className="text-gray-300">👥 Personas extras:</span>
                                  <span className="text-white font-semibold">${lastTripSummary.personasExtrasConfig.cost} MXN</span>
                                </div>
                              )}
                            </>
                          );
                        }

                        let baseFareToUse = (selectedTripType.id === 'cristoRey' && selectedSubTrip)
                          ? selectedSubTrip.fixedPrice
                          : (selectedTripType.fixedPrice || RATES.baseFare);

                        if (lastTripSummary.isFeriaActive) {
                          baseFareToUse = 60;
                        }

                        let baseCost = baseFareToUse;
                        let tripTypeExtraFee = 0;

                        for (const rate of RATES.distanceRates) {
                          if (lastTripSummary.distance >= rate.min && lastTripSummary.distance <= rate.max) {
                            if (rate.extraRate && lastTripSummary.distance > 8) {
                              const extraKm = lastTripSummary.distance - 8;
                              const adjustedBasePrice = (rate.basePrice! - RATES.baseFare) + baseFareToUse;
                              baseCost = adjustedBasePrice + (extraKm * rate.extraRate);
                            } else {
                              const priceIncrease = rate.price! - RATES.baseFare;
                              baseCost = baseFareToUse + priceIncrease;
                            }
                            break;
                          }
                        }

                        if ((selectedTripType.id !== 'normal' || (lastTripSummary.isSorianaActive && !selectedSorianaZone)) && lastTripSummary.distance >= 3.7) {
                          tripTypeExtraFee = 5;
                        }

                        return (
                          <>
                            {lastTripSummary.numeroParadas > 0 && (
                              <div className="flex justify-between items-center text-sm bg-blue-900/30 p-2 rounded">
                                <span className="text-blue-300">Paradas intermedias ({lastTripSummary.numeroParadas} x $50):</span>
                                <span className="text-white font-semibold">${lastTripSummary.costoParadas} MXN</span>
                              </div>
                            )}
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-gray-300">Costo por destino final ({lastTripSummary.distance.toFixed(1)} km):</span>
                              <span className="text-white font-semibold">${baseCost.toFixed(0)} MXN</span>
                            </div>
                            {waitingCost > 0 && (
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-300">Tiempo de espera:</span>
                                <span className="text-white font-semibold">${waitingCost.toFixed(0)} MXN</span>
                              </div>
                            )}
                            {tripTypeExtraFee > 0 && (
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-300">Extra tipo de viaje:</span>
                                <span className="text-white font-semibold">${tripTypeExtraFee} MXN</span>
                              </div>
                            )}
                            {petCost > 0 && (
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-300">🐕 Transporte mascota:</span>
                                <span className="text-white font-semibold">${petCost} MXN</span>
                              </div>
                            )}
                            {servicioEspecialCost > 0 && (
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-300">⭐ Servicio especial:</span>
                                <span className="text-white font-semibold">${servicioEspecialCost} MXN</span>
                              </div>
                            )}
                            {lastTripSummary.personasExtrasConfig.active && lastTripSummary.personasExtrasConfig.cost > 0 && (
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-300">👥 Personas extras:</span>
                                <span className="text-white font-semibold">${lastTripSummary.personasExtrasConfig.cost} MXN</span>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                    <div className="border-t border-gray-600 pt-2">
                      <div className="flex justify-between items-center">
                        <span className="text-white font-bold text-lg">Total a cobrar:</span>
                        <span className="font-bold text-2xl text-green-400">
                          ${(() => {
                            const waitingMinutes = Math.floor(lastTripSummary.waitingTime / 60);
                            const waitingCost = waitingMinutes * RATES.waitingRate;
                            const petCost = lastTripSummary.petConfig.active ? lastTripSummary.petConfig.cost : 0;
                            const servicioEspecialCost = lastTripSummary.servicioEspecialConfig.active ? lastTripSummary.servicioEspecialConfig.cost : 0;
                            const personasExtrasCost = lastTripSummary.personasExtrasConfig.active ? lastTripSummary.personasExtrasConfig.cost : 0;

                            // Si es zona lejana de Soriana, el costo es fijo de $70
                            const hadSorianaZoneInTotal = lastTripSummary.isSorianaActive &&
                              Math.abs(lastTripSummary.cost - (70 + lastTripSummary.costoParadas + waitingCost + petCost + servicioEspecialCost + personasExtrasCost)) < 1;

                            if (hadSorianaZoneInTotal) {
                              const totalFinal = lastTripSummary.costoParadas + 70 + waitingCost + petCost + servicioEspecialCost + personasExtrasCost;
                              return totalFinal.toFixed(0);
                            }

                            let baseFareToUse = (selectedTripType.id === 'cristoRey' && selectedSubTrip)
                              ? selectedSubTrip.fixedPrice
                              : (selectedTripType.fixedPrice || RATES.baseFare);

                            if (lastTripSummary.isFeriaActive) {
                              baseFareToUse = 60;
                            }

                            let distanceCost = baseFareToUse;
                            let tripTypeExtraFee = 0;

                            for (const rate of RATES.distanceRates) {
                              if (lastTripSummary.distance >= rate.min && lastTripSummary.distance <= rate.max) {
                                if (rate.extraRate && lastTripSummary.distance > 8) {
                                  const extraKm = lastTripSummary.distance - 8;
                                  const adjustedBasePrice = (rate.basePrice! - RATES.baseFare) + baseFareToUse;
                                  distanceCost = adjustedBasePrice + (extraKm * rate.extraRate);
                                } else {
                                  const priceIncrease = rate.price! - RATES.baseFare;
                                  distanceCost = baseFareToUse + priceIncrease;
                                }
                                break;
                              }
                            }

                            if ((selectedTripType.id !== 'normal' || (lastTripSummary.isSorianaActive && !selectedSorianaZone)) && lastTripSummary.distance >= 3.7) {
                              tripTypeExtraFee = 5;
                            }

                            const totalFinal = lastTripSummary.costoParadas + distanceCost + waitingCost + petCost + servicioEspecialCost + personasExtrasCost + tripTypeExtraFee;
                            return totalFinal.toFixed(0);
                          })()} MXN
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="text-center text-sm text-gray-400">
                  Viaje finalizado: {lastTripSummary.timestamp}
                </div>
                
                <button
                  onClick={() => {
                    setShowSummary(false);
                    // Resetear completamente el tiempo de espera cuando se cierra el resumen
                    setTotalWaitingTime(0);
                    setTripData(prev => ({
                      ...prev,
                      waitingTime: 0
                    }));
                  }}
                  className="w-full bg-gradient-to-r from-yellow-400 to-yellow-500 hover:from-yellow-500 hover:to-yellow-600 text-black font-bold py-3 px-4 rounded-lg transition-all transform hover:scale-105 shadow-lg"
                >
                  Cerrar Resumen
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal de selección de tipo de viaje */}
        {showTripTypeSelector && (
          <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4">
            <div className="bg-gradient-to-br from-gray-900 to-black border border-yellow-400 rounded-xl p-6 max-w-sm w-full shadow-2xl">
              <div className="flex items-center justify-center mb-4">
                <Route className="w-8 h-8 text-yellow-400 mr-2" />
                <h2 className="text-2xl font-bold text-center text-white">
                  Tipo de Viaje
                </h2>
              </div>
              
              <div className="space-y-3">
                {TRIP_TYPES.map((tripType) => (
                  <button
                    key={tripType.id}
                    onClick={() => {
                      if (tripType.id === 'cristoRey') {
                        setSelectedTripType(tripType);
                        setShowTripTypeSelector(false);
                        setShowSubTripSelector(true);
                      } else {
                        setSelectedTripType(tripType);
                        setSelectedSubTrip(null);
                        setShowTripTypeSelector(false);
                      }
                    }}
                    className={`w-full p-4 rounded-xl border-2 transition-all text-left ${
                      selectedTripType.id === tripType.id
                        ? 'border-yellow-400 bg-yellow-400/10 text-yellow-400'
                        : 'border-gray-600 bg-gray-800 text-white hover:border-yellow-400/50'
                    }`}
                  >
                    <div className="font-bold text-lg">{tripType.name}</div>
                    <div className="text-sm text-gray-300 mt-1">{tripType.description}</div>
                    {tripType.fixedPrice && (
                      <div className="text-green-400 font-bold mt-2">
                        Precio base: ${tripType.fixedPrice} MXN
                      </div>
                    )}
                    {tripType.subTrips && (
                      <div className="text-blue-400 font-bold mt-2">
                        → Seleccionar destino específico
                      </div>
                    )}
                  </button>
                ))}
              </div>
              
              <button
                onClick={() => setShowTripTypeSelector(false)}
                className="w-full mt-4 bg-gradient-to-r from-gray-700 to-gray-600 hover:from-gray-600 hover:to-gray-500 text-white font-bold py-3 px-4 rounded-lg transition-all"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Modal de selección de sub-destino para Cristo Rey */}
        {showSubTripSelector && (
          <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4">
            <div className="bg-gradient-to-br from-gray-900 to-black border border-yellow-400 rounded-xl p-6 max-w-sm w-full shadow-2xl">
              <div className="flex items-center justify-center mb-4">
                <MapPin className="w-8 h-8 text-yellow-400 mr-2" />
                <h2 className="text-2xl font-bold text-center text-white">
                  Cristo Rey - Destino
                </h2>
              </div>
              
              <div className="space-y-3">
                {selectedTripType.subTrips?.map((subTrip) => (
                  <button
                    key={subTrip.id}
                    onClick={() => {
                      setSelectedSubTrip(subTrip);
                      setShowSubTripSelector(false);
                    }}
                    className={`w-full p-4 rounded-xl border-2 transition-all text-left ${
                      selectedSubTrip?.id === subTrip.id
                        ? 'border-yellow-400 bg-yellow-400/10 text-yellow-400'
                        : 'border-gray-600 bg-gray-800 text-white hover:border-yellow-400/50'
                    }`}
                  >
                    <div className="font-bold text-lg">{subTrip.name}</div>
                    <div className="text-green-400 font-bold mt-2">
                      Precio: ${subTrip.fixedPrice} MXN
                    </div>
                  </button>
                ))}
              </div>
              
              <button
                onClick={() => {
                  setShowSubTripSelector(false);
                  setShowTripTypeSelector(true);
                }}
                className="w-full mt-4 bg-gradient-to-r from-gray-700 to-gray-600 hover:from-gray-600 hover:to-gray-500 text-white font-bold py-3 px-4 rounded-lg transition-all"
              >
                Volver
              </button>
            </div>
          </div>
        )}

        {/* Modal de selección de extras */}
        {showExtrasSelector && (
          <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4">
            <div className="bg-gradient-to-br from-gray-900 to-black border border-yellow-400 rounded-xl p-6 max-w-sm w-full shadow-2xl">
              <div className="flex items-center justify-center mb-4">
                <DollarSign className="w-8 h-8 text-yellow-400 mr-2" />
                <h2 className="text-2xl font-bold text-center text-white">
                  Extras
                </h2>
              </div>
              
              <div className="space-y-3">
                <label className="flex items-center bg-gradient-to-r from-gray-800 to-gray-700 hover:from-gray-700 hover:to-gray-600 text-white p-4 rounded-xl cursor-pointer transition-all border border-gray-600 hover:border-yellow-400/50 shadow-lg">
                  <input
                    type="checkbox"
                    checked={serviciosExtrasActive}
                    onChange={(e) => setServiciosExtrasActive(e.target.checked)}
                    className="w-5 h-5 mr-3 accent-yellow-400"
                  />
                  <div className="flex-1">
                    <div className="font-bold text-lg">Servicios Extras</div>
                    <div className="text-sm text-gray-300 mt-1">
                      Servicios adicionales durante el viaje
                    </div>
                  </div>
                </label>

                <label className="flex items-center bg-gradient-to-r from-purple-800 to-purple-700 hover:from-purple-700 hover:to-purple-600 text-white p-4 rounded-xl cursor-pointer transition-all border border-purple-600 hover:border-yellow-400/50 shadow-lg">
                  <input
                    type="checkbox"
                    checked={servicioEspecialConfig.active}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setShowServicioEspecialSelector(true);
                      } else {
                        setServicioEspecialConfig({
                          active: false,
                          type: null,
                          cost: 0
                        });
                      }
                    }}
                    className="w-5 h-5 mr-3 accent-purple-400"
                  />
                  <div className="flex-1">
                    <div className="font-bold text-lg">⭐ Servicio Especial</div>
                    <div className="text-sm text-purple-200 mt-1">
                      {servicioEspecialConfig.active
                        ? `${servicioEspecialConfig.type === 'recoger' ? 'Solo recoger y llevar' : 'Comprar y llevar'} - +$${servicioEspecialConfig.cost} MXN`
                        : 'Recoger y llevar o comprar y llevar'
                      }
                    </div>
                  </div>
                </label>
                
                <label className="flex items-center bg-gradient-to-r from-blue-800 to-blue-700 hover:from-blue-700 hover:to-blue-600 text-white p-4 rounded-xl cursor-pointer transition-all border border-blue-600 hover:border-yellow-400/50 shadow-lg">
                  <input
                    type="checkbox"
                    checked={petConfig.active}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setShowPetSelector(true);
                      } else {
                        setPetConfig({
                          active: false,
                          withCage: null,
                          cost: 0
                        });
                      }
                    }}
                    className="w-5 h-5 mr-3 accent-blue-400"
                  />
                  <div className="flex-1">
                    <div className="font-bold text-lg">🐕 Transporte de Mascotas</div>
                    <div className="text-sm text-blue-200 mt-1">
                      {petConfig.active
                        ? `${petConfig.withCage ? 'Con jaula' : 'Sin jaula'} - +$${petConfig.cost} MXN`
                        : 'Costo adicional según jaula'
                      }
                    </div>
                  </div>
                </label>

                <label className="flex items-center bg-gradient-to-r from-green-800 to-green-700 hover:from-green-700 hover:to-green-600 text-white p-4 rounded-xl cursor-pointer transition-all border border-green-600 hover:border-yellow-400/50 shadow-lg">
                  <input
                    type="checkbox"
                    checked={personasExtrasConfig.active}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setShowPersonasExtrasSelector(true);
                      } else {
                        setPersonasExtrasConfig({
                          active: false,
                          ninos: 0,
                          adultos: 0,
                          cost: 0
                        });
                      }
                    }}
                    className="w-5 h-5 mr-3 accent-green-400"
                  />
                  <div className="flex-1">
                    <div className="font-bold text-lg">👥 Personas Extras</div>
                    <div className="text-sm text-green-200 mt-1">
                      {personasExtrasConfig.active
                        ? `${personasExtrasConfig.ninos > 0 ? `${personasExtrasConfig.ninos} niño${personasExtrasConfig.ninos > 1 ? 's' : ''}` : ''}${personasExtrasConfig.ninos > 0 && personasExtrasConfig.adultos > 0 ? ' + ' : ''}${personasExtrasConfig.adultos > 0 ? `${personasExtrasConfig.adultos} adulto${personasExtrasConfig.adultos > 1 ? 's' : ''}` : ''} - +$${personasExtrasConfig.cost} MXN`
                        : 'Niños o adultos adicionales'
                      }
                    </div>
                  </div>
                </label>
              </div>

              <div className="mt-4 bg-yellow-900/30 border border-yellow-600/50 p-3 rounded-lg">
                <p className="text-yellow-200 text-xs text-center font-semibold">
                  ⚠️ El chofer decide si llevar más de 4 pasajeros
                </p>
              </div>
              
              <button
                onClick={() => setShowExtrasSelector(false)}
                className="w-full mt-4 bg-gradient-to-r from-yellow-400 to-yellow-500 hover:from-yellow-500 hover:to-yellow-600 text-black font-bold py-3 px-4 rounded-lg transition-all"
              >
                Confirmar
              </button>
            </div>
          </div>
        )}

        {/* Modal de selección de servicio especial */}
        {showServicioEspecialSelector && (
          <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4">
            <div className="bg-gradient-to-br from-gray-900 to-black border border-yellow-400 rounded-xl p-6 max-w-sm w-full shadow-2xl">
              <div className="flex items-center justify-center mb-4">
                <span className="text-4xl mr-2">⭐</span>
                <h2 className="text-2xl font-bold text-center text-white">
                  Servicio Especial
                </h2>
              </div>

              <div className="mb-4 text-center text-gray-300">
                Selecciona el tipo de servicio
              </div>

              <div className="space-y-3">
                <button
                  onClick={() => {
                    setServicioEspecialConfig({
                      active: true,
                      type: 'recoger',
                      cost: 10
                    });
                    setShowServicioEspecialSelector(false);
                  }}
                  className="w-full p-4 rounded-xl border-2 border-blue-600 bg-blue-800 text-white hover:border-blue-400 transition-all text-left"
                >
                  <div className="font-bold text-lg">📦 Solo recoger y llevar</div>
                  <div className="text-blue-300 font-bold mt-2">
                    Costo adicional: +$10 MXN
                  </div>
                </button>

                <button
                  onClick={() => {
                    setServicioEspecialConfig({
                      active: true,
                      type: 'comprar',
                      cost: 20
                    });
                    setShowServicioEspecialSelector(false);
                  }}
                  className="w-full p-4 rounded-xl border-2 border-green-600 bg-green-800 text-white hover:border-green-400 transition-all text-left"
                >
                  <div className="font-bold text-lg">🛒 Comprar y llevar</div>
                  <div className="text-green-300 font-bold mt-2">
                    Costo adicional: +$20 MXN
                  </div>
                </button>
              </div>

              <button
                onClick={() => {
                  setShowServicioEspecialSelector(false);
                  setServicioEspecialConfig({
                    active: false,
                    type: null,
                    cost: 0
                  });
                }}
                className="w-full mt-4 bg-gradient-to-r from-gray-700 to-gray-600 hover:from-gray-600 hover:to-gray-500 text-white font-bold py-3 px-4 rounded-lg transition-all"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Modal de selección de personas extras */}
        {showPersonasExtrasSelector && (
          <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4">
            <div className="bg-gradient-to-br from-gray-900 to-black border border-yellow-400 rounded-xl p-6 max-w-sm w-full shadow-2xl">
              <div className="flex items-center justify-center mb-4">
                <span className="text-4xl mr-2">👥</span>
                <h2 className="text-2xl font-bold text-center text-white">
                  Personas Extras
                </h2>
              </div>

              <div className="mb-4 text-center text-gray-300">
                Selecciona la cantidad de personas extras
              </div>

              <div className="space-y-4">
                <div className="bg-gradient-to-br from-gray-800 to-gray-900 p-4 rounded-xl border border-blue-600">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center">
                      <span className="text-2xl mr-2">👶</span>
                      <div>
                        <div className="font-bold text-lg text-white">Niños</div>
                        <div className="text-sm text-blue-300">$10 MXN c/u</div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <button
                        onClick={() => {
                          const newNinos = Math.max(0, personasExtrasConfig.ninos - 1);
                          const newCost = (newNinos * 10) + (personasExtrasConfig.adultos * 20);
                          setPersonasExtrasConfig({
                            active: newNinos > 0 || personasExtrasConfig.adultos > 0,
                            ninos: newNinos,
                            adultos: personasExtrasConfig.adultos,
                            cost: newCost
                          });
                        }}
                        className="w-10 h-10 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold text-xl transition-all"
                      >
                        -
                      </button>
                      <span className="text-2xl font-bold text-white min-w-[2rem] text-center">{personasExtrasConfig.ninos}</span>
                      <button
                        onClick={() => {
                          const newNinos = personasExtrasConfig.ninos + 1;
                          const newCost = (newNinos * 10) + (personasExtrasConfig.adultos * 20);
                          setPersonasExtrasConfig({
                            active: true,
                            ninos: newNinos,
                            adultos: personasExtrasConfig.adultos,
                            cost: newCost
                          });
                        }}
                        className="w-10 h-10 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold text-xl transition-all"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-gray-800 to-gray-900 p-4 rounded-xl border border-green-600">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center">
                      <span className="text-2xl mr-2">🧑</span>
                      <div>
                        <div className="font-bold text-lg text-white">Adultos</div>
                        <div className="text-sm text-green-300">$20 MXN c/u</div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <button
                        onClick={() => {
                          const newAdultos = Math.max(0, personasExtrasConfig.adultos - 1);
                          const newCost = (personasExtrasConfig.ninos * 10) + (newAdultos * 20);
                          setPersonasExtrasConfig({
                            active: personasExtrasConfig.ninos > 0 || newAdultos > 0,
                            ninos: personasExtrasConfig.ninos,
                            adultos: newAdultos,
                            cost: newCost
                          });
                        }}
                        className="w-10 h-10 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold text-xl transition-all"
                      >
                        -
                      </button>
                      <span className="text-2xl font-bold text-white min-w-[2rem] text-center">{personasExtrasConfig.adultos}</span>
                      <button
                        onClick={() => {
                          const newAdultos = personasExtrasConfig.adultos + 1;
                          const newCost = (personasExtrasConfig.ninos * 10) + (newAdultos * 20);
                          setPersonasExtrasConfig({
                            active: true,
                            ninos: personasExtrasConfig.ninos,
                            adultos: newAdultos,
                            cost: newCost
                          });
                        }}
                        className="w-10 h-10 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold text-xl transition-all"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>

                {personasExtrasConfig.cost > 0 && (
                  <div className="bg-yellow-900/30 border border-yellow-600/50 p-3 rounded-lg">
                    <div className="flex justify-between items-center">
                      <span className="text-yellow-200 font-semibold">Costo total:</span>
                      <span className="text-yellow-400 font-bold text-xl">+${personasExtrasConfig.cost} MXN</span>
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={() => {
                  setShowPersonasExtrasSelector(false);
                }}
                className="w-full mt-4 bg-gradient-to-r from-yellow-400 to-yellow-500 hover:from-yellow-500 hover:to-yellow-600 text-black font-bold py-3 px-4 rounded-lg transition-all"
              >
                Confirmar
              </button>

              <button
                onClick={() => {
                  setShowPersonasExtrasSelector(false);
                  setPersonasExtrasConfig({
                    active: false,
                    ninos: 0,
                    adultos: 0,
                    cost: 0
                  });
                }}
                className="w-full mt-2 bg-gradient-to-r from-gray-700 to-gray-600 hover:from-gray-600 hover:to-gray-500 text-white font-bold py-3 px-4 rounded-lg transition-all"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Modal de Finalizar Parada */}
        {showFinalizarParada && (
          <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4">
            <div className="bg-gradient-to-br from-gray-900 to-black border border-yellow-400 rounded-xl p-6 max-w-sm w-full shadow-2xl">
              <div className="flex items-center justify-center mb-4">
                <Square className="w-8 h-8 text-yellow-400 mr-2" />
                <h2 className="text-2xl font-bold text-center text-white">
                  Parada
                </h2>
              </div>

              <div className="space-y-3">
                <button
                  onClick={() => {
                    setCostoAcumuladoParadas(prev => prev + 50);
                    setNumeroParadas(prev => prev + 1);
                    setTripData(prev => ({
                      ...prev,
                      waitingTime: 0
                    }));
                    setTotalWaitingTime(0);
                    stopWaitingTimer();
                    setShowFinalizarParada(false);
                  }}
                  className="w-full p-4 rounded-xl border-2 border-green-600 bg-green-800 text-white hover:border-green-400 transition-all"
                >
                  <div className="font-bold text-lg">Servicio</div>
                  <div className="text-sm text-green-300 mt-1">+$50 MXN por parada</div>
                </button>

                <button
                  onClick={() => {
                    setCostoAcumuladoParadas(prev => prev + 10);
                    setNumeroParadas(prev => prev + 1);
                    setTripData(prev => ({
                      ...prev,
                      waitingTime: 0
                    }));
                    setTotalWaitingTime(0);
                    stopWaitingTimer();
                    setShowFinalizarParada(false);
                  }}
                  className="w-full p-4 rounded-xl border-2 border-blue-600 bg-blue-800 text-white hover:border-blue-400 transition-all"
                >
                  <div className="font-bold text-lg">Bajada</div>
                  <div className="text-sm text-blue-300 mt-1">+$10 MXN por parada</div>
                </button>

                <button
                  onClick={() => {
                    setShowFinalizarParada(false);
                    stopTrip();
                  }}
                  className="w-full p-4 rounded-xl border-2 border-red-600 bg-red-800 text-white hover:border-red-400 transition-all"
                >
                  <div className="font-bold text-lg">Finalizar</div>
                </button>
              </div>

              <button
                onClick={() => setShowFinalizarParada(false)}
                className="w-full mt-4 bg-gradient-to-r from-gray-700 to-gray-600 hover:from-gray-600 hover:to-gray-500 text-white font-bold py-3 px-4 rounded-lg transition-all"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Modal de selección de jaula para mascotas */}
        {showPetSelector && (
          <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4">
            <div className="bg-gradient-to-br from-gray-900 to-black border border-yellow-400 rounded-xl p-6 max-w-sm w-full shadow-2xl">
              <div className="flex items-center justify-center mb-4">
                <span className="text-4xl mr-2">🐕</span>
                <h2 className="text-2xl font-bold text-center text-white">
                  Transporte de Mascotas
                </h2>
              </div>
              
              <div className="mb-4 text-center text-gray-300">
                ¿La mascota lleva jaula?
              </div>
              
              <div className="space-y-3">
                <button
                  onClick={() => {
                    setPetConfig({
                      active: true,
                      withCage: true,
                      cost: 20
                    });
                    setShowPetSelector(false);
                  }}
                  className="w-full p-4 rounded-xl border-2 border-green-600 bg-green-800 text-white hover:border-green-400 transition-all text-left"
                >
                  <div className="font-bold text-lg">✅ Sí, con jaula</div>
                  <div className="text-green-300 font-bold mt-2">
                    Costo adicional: +$20 MXN
                  </div>
                </button>
                
                <button
                  onClick={() => {
                    setPetConfig({
                      active: true,
                      withCage: false,
                      cost: 30
                    });
                    setShowPetSelector(false);
                  }}
                  className="w-full p-4 rounded-xl border-2 border-orange-600 bg-orange-800 text-white hover:border-orange-400 transition-all text-left"
                >
                  <div className="font-bold text-lg">❌ No, sin jaula</div>
                  <div className="text-orange-300 font-bold mt-2">
                    Costo adicional: +$30 MXN
                  </div>
                </button>
              </div>
              
              <button
                onClick={() => {
                  setShowPetSelector(false);
                  setPetConfig({
                    active: false,
                    withCage: null,
                    cost: 0
                  });
                }}
                className="w-full mt-4 bg-gradient-to-r from-gray-700 to-gray-600 hover:from-gray-600 hover:to-gray-500 text-white font-bold py-3 px-4 rounded-lg transition-all"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="bg-gradient-to-r from-black via-gray-900 to-black border-b-2 border-yellow-400 rounded-t-xl p-6 text-center shadow-2xl">
          <div className="flex items-center justify-center mb-2">
            <span className="text-4xl mr-3">🎪</span>
            <div>
              <h1 className="text-3xl font-bold text-white tracking-wider">Feria Zapotlán 2025</h1>
            </div>
            <span className="text-4xl ml-3">🎡</span>
          </div>
          <div className="flex items-center justify-center mt-2">
            <div className={`w-4 h-4 rounded-full ${getStatusColor()} mr-2 animate-pulse shadow-lg`}></div>
            <span className="text-sm text-gray-300 font-medium">{getStatusText()}</span>
            {(selectedTripType.id !== 'normal' || selectedSubTrip) && (
              <span className="ml-2 text-xs bg-yellow-400 text-black px-2 py-1 rounded-full font-bold">
                {selectedSubTrip ? `${selectedTripType.name} - ${selectedSubTrip.name}` : selectedTripType.name}
              </span>
            )}
          </div>
        </div>

        {/* Pantalla principal */}
        <div className="bg-gradient-to-b from-gray-900 to-black text-yellow-400 p-6 text-center border-x-2 border-yellow-400">
          <div className="text-6xl font-mono font-bold mb-6 bg-gradient-to-br from-black to-gray-900 p-6 rounded-xl border-2 border-yellow-400 shadow-2xl relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-yellow-400/5 to-transparent animate-pulse"></div>
            ${tripData.cost.toFixed(0)} MXN
          </div>
          
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="bg-gradient-to-br from-gray-800 to-gray-900 p-4 rounded-xl border border-gray-700 shadow-lg hover:border-yellow-400/50 transition-all">
              <div className="flex items-center justify-center mb-1">
                <Route className="w-5 h-5 mr-1 text-yellow-400" />
              </div>
              <div className="text-xs text-gray-400 font-semibold">DISTANCIA</div>
              <div className="font-mono font-bold text-white">{tripData.distance.toFixed(3)} km</div>
            </div>
            
            <div className="bg-gradient-to-br from-gray-800 to-gray-900 p-4 rounded-xl border border-gray-700 shadow-lg hover:border-yellow-400/50 transition-all">
              <div className="flex items-center justify-center mb-1">
                <Clock className="w-5 h-5 mr-1 text-yellow-400" />
              </div>
              <div className="text-xs text-gray-400 font-semibold">ESPERA</div>
              <div className="font-mono font-bold text-white">{formatTime(tripData.waitingTime)}</div>
            </div>
            
            <div className="bg-gradient-to-br from-gray-800 to-gray-900 p-4 rounded-xl border border-gray-700 shadow-lg hover:border-yellow-400/50 transition-all">
              <div className="flex items-center justify-center mb-1">
                <Navigation className="w-5 h-5 mr-1 text-yellow-400" />
              </div>
              <div className="text-xs text-gray-400 font-semibold">GPS</div>
              <div className="font-bold text-xs text-white">
                {gpsStatus === 'available' && currentPosition ? (googleMapsReady ? 'Maps+GPS' : 'GPS Básico') : 
                 gpsStatus === 'requesting' ? 'Buscando...' :
                 gpsStatus === 'denied' ? 'Sin acceso' : 'No disponible'}
              </div>
            </div>
          </div>

          {/* Información de ubicación actual */}
          {currentPosition && currentAddress && (
            <div className="mt-4 bg-gradient-to-br from-gray-800 to-gray-900 p-3 rounded-xl border border-gray-700 shadow-lg">
              <div className="flex items-center justify-center mb-2">
                <MapPin className="w-4 h-4 text-yellow-400 mr-2" />
                <span className="text-xs text-gray-400 font-semibold">UBICACIÓN ACTUAL</span>
              </div>
              <div className="text-xs text-white text-center break-words">
                {currentAddress}
              </div>
            </div>
          )}
          
          {/* Indicador de Soriana activo durante el viaje */}
          {tripData.isRunning && isSorianaActive && (
            <div className="mt-4 bg-gradient-to-r from-orange-600 to-orange-700 p-3 rounded-xl border border-orange-500 shadow-lg">
              <div className="flex items-center justify-center">
                <span className="text-white font-bold text-sm">
                  🏪 VIAJE DE SORIANA
                </span>
              </div>
            </div>
          )}

          {/* Indicador de paradas acumuladas */}
          {tripData.isRunning && numeroParadas > 0 && (
            <div className="mt-4 bg-gradient-to-r from-blue-600 to-blue-700 p-3 rounded-xl border border-blue-500 shadow-lg">
              <div className="flex items-center justify-center">
                <span className="text-white font-bold text-sm">
                  🛑 {numeroParadas} Parada{numeroParadas > 1 ? 's' : ''} ({numeroParadas} x $50 = ${costoAcumuladoParadas} MXN)
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Controles */}
        <div className="bg-gradient-to-b from-black to-gray-900 p-6 rounded-b-xl border-2 border-t-0 border-yellow-400 shadow-2xl">
          {/* Botón INICIAR */}
          {!tripData.isRunning && (
            <div className="flex justify-center mb-4">
              <button
                onClick={startTrip}
                disabled={gpsStatus !== 'available'}
                className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed text-white px-8 py-4 rounded-xl flex items-center font-bold text-lg transition-all transform hover:scale-105 shadow-lg border border-green-400"
              >
                <Play className="w-6 h-6 mr-2 drop-shadow-lg" />
                INICIAR
              </button>
            </div>
          )}

          {/* Check de Feria */}
          {!tripData.isRunning && (
            <div className="mb-4">
              <label className="flex items-center bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white p-4 rounded-xl cursor-pointer transition-all border border-purple-500 shadow-lg">
                <input
                  type="checkbox"
                  checked={isFeriaActive}
                  onChange={(e) => setIsFeriaActive(e.target.checked)}
                  className="w-5 h-5 mr-3 accent-purple-400"
                />
                <div className="flex-1">
                  <div className="font-bold text-lg">🎡 Feria</div>

                </div>
              </label>
            </div>
          )}

          {/* Check de Soriana */}
          {!tripData.isRunning && (
            <div className="mb-4">
              <label className="flex items-center bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800 text-white p-4 rounded-xl cursor-pointer transition-all border border-orange-500 shadow-lg">
                <input
                  type="checkbox"
                  checked={isSorianaActive}
                  onChange={(e) => setIsSorianaActive(e.target.checked)}
                  className="w-5 h-5 mr-3 accent-orange-400"
                />
                <div className="flex-1">
                  <div className="font-bold text-lg">🏪 Soriana</div>
                  {isSorianaActive && selectedSorianaZone && (
                    <div className="text-sm text-orange-200 mt-1">
                      Zona: {selectedSorianaZone}
                    </div>
                  )}
                </div>
              </label>

              {/* Mostrar zonas cuando está activo */}
              {isSorianaActive && (
                <div className="mt-3 bg-gradient-to-br from-gray-800 to-gray-900 p-4 rounded-xl border border-orange-500 shadow-lg">
                  <div className="text-center mb-3">
                    <span className="text-yellow-400 font-bold text-lg">Zonas Lejanas</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {SORIANA_ZONES.map((zone) => (
                      <label
                        key={zone}
                        className="flex items-start cursor-pointer hover:bg-gray-700 p-2 rounded transition-all"
                      >
                        <input
                          type="radio"
                          name="sorianaZone"
                          checked={selectedSorianaZone === zone}
                          onChange={() => setSelectedSorianaZone(zone)}
                          className="w-4 h-4 mr-2 mt-0.5 accent-orange-400"
                        />
                        <span className="text-white text-sm">{zone}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Selector de tipo de viaje */}
          {!tripData.isRunning && (
            <div className="mb-4">
              <button
                onClick={() => setShowTripTypeSelector(true)}
                className="w-full bg-gradient-to-r from-gray-800 to-gray-700 hover:from-gray-700 hover:to-gray-600 text-yellow-400 p-4 rounded-xl flex items-center justify-between font-bold transition-all border border-gray-600 hover:border-yellow-400/50 shadow-lg"
              >
                <div className="flex items-center">
                  <Route className="w-5 h-5 mr-2" />
                  <div className="text-left">
                    <div className="font-bold text-lg">{selectedTripType.name}</div>
                    <div className="text-sm text-gray-300">{selectedTripType.description}</div>
                    {selectedSubTrip && (
                      <div className="text-sm text-blue-400">Destino: {selectedSubTrip.name}</div>
                    )}
                  </div>
                </div>
                <ChevronDown className="w-5 h-5 ml-2" />
              </button>
            </div>
          )}
          
          {/* Selector de extras - disponible antes Y durante el viaje */}
          <div className="mb-4">
            <button
              onClick={() => setShowExtrasSelector(true)}
              className="w-full bg-gradient-to-r from-gray-800 to-gray-700 hover:from-gray-700 hover:to-gray-600 text-yellow-400 p-4 rounded-xl flex items-center justify-between font-bold transition-all border border-gray-600 hover:border-yellow-400/50 shadow-lg"
            >
              <div className="flex items-center">
                <DollarSign className="w-5 h-5 mr-2" />
                <div className="text-left">
                  <div className="font-bold text-lg">Extras</div>
                  <div className="text-sm text-gray-300">
                    {serviciosExtrasActive || petConfig.active || servicioEspecialConfig.active || personasExtrasConfig.active
                      ? [
                          serviciosExtrasActive ? 'Servicios Extras' : '',
                          petConfig.active ? `Mascotas ${petConfig.withCage ? '(con jaula)' : '(sin jaula)'}` : '',
                          servicioEspecialConfig.active ? `Servicio Especial (${servicioEspecialConfig.type === 'recoger' ? 'recoger' : 'comprar'})` : '',
                          personasExtrasConfig.active ? `Personas extras (${personasExtrasConfig.ninos > 0 ? `${personasExtrasConfig.ninos} niño${personasExtrasConfig.ninos > 1 ? 's' : ''}` : ''}${personasExtrasConfig.ninos > 0 && personasExtrasConfig.adultos > 0 ? ', ' : ''}${personasExtrasConfig.adultos > 0 ? `${personasExtrasConfig.adultos} adulto${personasExtrasConfig.adultos > 1 ? 's' : ''}` : ''})` : ''
                        ].filter(Boolean).join(', ')
                      : 'Servicios adicionales'
                    }
                  </div>
                </div>
              </div>
              <div className="flex items-center">
                {(serviciosExtrasActive || petConfig.active || servicioEspecialConfig.active || personasExtrasConfig.active) && (
                  <span className="text-xs bg-yellow-400 text-black px-2 py-1 rounded-full font-bold mr-2">
                    ACTIVO
                  </span>
                )}
                <ChevronDown className="w-5 h-5" />
              </div>
            </button>
          </div>
          
          {/* Botón de simulación */}
          <div className="mb-4">
            <button
              onClick={toggleSimulation}
              className={`w-full ${isSimulating ? 'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700' : 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700'} text-white p-4 rounded-xl flex items-center justify-center font-bold transition-all border ${isSimulating ? 'border-red-400' : 'border-blue-400'} shadow-lg`}
            >
              {isSimulating ? (
                <>
                  <Square className="w-5 h-5 mr-2" />
                  DETENER SIMULACIÓN
                </>
              ) : (
                <>
                  <Play className="w-5 h-5 mr-2" />
                  INICIAR SIMULACIÓN
                </>
              )}
            </button>
          </div>

          <div className="flex justify-center space-x-4">
            {tripData.isRunning && (
              <>
                <button
                  onClick={togglePause}
                  className="bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 text-black px-6 py-4 rounded-xl flex items-center font-bold transition-all transform hover:scale-105 shadow-lg border border-yellow-400"
                >
                  {tripData.isPaused ? (
                    <>
                      <Play className="w-5 h-5 mr-2 drop-shadow-lg" />
                      REANUDAR
                    </>
                  ) : (
                    <>
                      <Pause className="w-5 h-5 mr-2 drop-shadow-lg" />
                      PAUSAR
                    </>
                  )}
                </button>
                
                <button
                  onClick={() => {
                    if (serviciosExtrasActive) {
                      setShowFinalizarParada(true);
                    } else {
                      stopTrip();
                    }
                  }}
                  className="bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white px-6 py-4 rounded-xl flex items-center font-bold transition-all transform hover:scale-105 shadow-lg border border-red-400"
                >
                  <Square className="w-5 h-5 mr-2 drop-shadow-lg" />
                  {serviciosExtrasActive ? 'PARADA' : 'FINALIZAR'}
                </button>
              </>
            )}
          </div>

          {/* Información de tarifas */}
          <div className="mt-6">
            <button
              onClick={() => setShowRates(!showRates)}
              className="w-full bg-gradient-to-r from-gray-800 to-gray-700 hover:from-gray-700 hover:to-gray-600 text-yellow-400 p-4 rounded-xl flex items-center justify-center font-bold transition-all border border-gray-600 hover:border-yellow-400/50 shadow-lg"
            >
              <Info className="w-5 h-5 mr-2" />
              VER TARIFAS
              {showRates ? (
                <ChevronUp className="w-5 h-5 ml-2" />
              ) : (
                <ChevronDown className="w-5 h-5 ml-2" />
              )}
            </button>
            
            {showRates && (
              <div className="mt-3 bg-gradient-to-br from-gray-800 to-gray-900 p-4 rounded-xl border border-gray-600 shadow-lg">
                <div className="flex items-center justify-center mb-3">
                  <Zap className="w-5 h-5 text-yellow-400 mr-2" />
                  <h3 className="text-yellow-400 font-bold text-center">TARIFAS SPEED CABS</h3>
                </div>
                <div className="text-white text-sm space-y-1">
                  <div className="flex justify-between">
                    <span>Tarifa base:</span>
                    <span className="text-yellow-400 font-semibold">${RATES.baseFare} MXN</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Tiempo espera:</span>
                    <span className="text-yellow-400 font-semibold">$3 MXN/min</span>
                  </div>
                  <div className="text-xs text-gray-300 mt-3 bg-gray-800 p-2 rounded-lg">
                    <div className="flex justify-between"><span>0-3.9 km:</span><span className="text-yellow-400">$50 MXN</span></div>
                    <div className="flex justify-between"><span>4-4.9 km:</span><span className="text-yellow-400">$55 MXN</span></div>
                    <div className="flex justify-between"><span>5-5.9 km:</span><span className="text-yellow-400">$60 MXN</span></div>
                    <div className="flex justify-between"><span>6-6.9 km:</span><span className="text-yellow-400">$65 MXN</span></div>
                    <div className="flex justify-between"><span>7-7.9 km:</span><span className="text-yellow-400">$70 MXN</span></div>
                    <div className="flex justify-between"><span>8+ km:</span><span className="text-yellow-400">$80 MXN</span></div>
                    <div className="flex justify-between"><span>8+ km:</span><span className="text-yellow-400">$16/km extra</span></div>
                    <div className="text-center mt-2 pt-2 border-t border-gray-600">
                      <span className="text-yellow-400 text-xs">
                        {googleMapsReady ? '✓ Google Maps Activo' : '⚠ GPS Básico'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {gpsStatus === 'denied' && (
            <div className="mt-4 bg-gradient-to-r from-red-600 to-red-700 text-white p-4 rounded-xl text-center border border-red-500 shadow-lg">
              <p className="text-sm">Se necesita acceso a la ubicación para funcionar correctamente.</p>
            </div>
          )}

          {gpsStatus === 'unavailable' && (
            <div className="mt-4 bg-gradient-to-r from-orange-600 to-orange-700 text-white p-4 rounded-xl text-center border border-orange-500 shadow-lg">
              <p className="text-sm">GPS no disponible en este dispositivo.</p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

export default App;