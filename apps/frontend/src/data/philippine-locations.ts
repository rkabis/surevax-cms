export type Region = {
  name: string
  provinces: Province[]
}

export type Province = {
  name: string
  cities: string[]
}

export const philippineRegions: Region[] = [
  {
    name: 'National Capital Region (NCR)',
    provinces: [
      {
        name: 'Metro Manila',
        cities: [
          'Caloocan',
          'Las Piñas',
          'Makati',
          'Malabon',
          'Mandaluyong',
          'Manila',
          'Marikina',
          'Muntinlupa',
          'Navotas',
          'Parañaque',
          'Pasay',
          'Pasig',
          'Pateros',
          'Quezon City',
          'San Juan',
          'Taguig',
          'Valenzuela',
        ],
      },
    ],
  },
  {
    name: 'Cordillera Administrative Region (CAR)',
    provinces: [
      { name: 'Abra', cities: ['Bangued', 'Boliney', 'Bucay', 'Dolores', 'Lagangilang'] },
      { name: 'Apayao', cities: ['Calanasan', 'Conner', 'Flora', 'Kabugao', 'Luna'] },
      { name: 'Benguet', cities: ['Baguio City', 'Itogon', 'La Trinidad', 'Mankayan', 'Tuba'] },
      { name: 'Ifugao', cities: ['Banaue', 'Hungduan', 'Kiangan', 'Lagawe', 'Lamut'] },
      { name: 'Kalinga', cities: ['Balbalan', 'Lubuagan', 'Pasil', 'Tabuk', 'Tanudan'] },
      { name: 'Mountain Province', cities: ['Barlig', 'Bauko', 'Bontoc', 'Natonin', 'Sagada'] },
    ],
  },
  {
    name: 'Region I (Ilocos Region)',
    provinces: [
      { name: 'Ilocos Norte', cities: ['Batac', 'Laoag', 'Pasuquin', 'San Nicolas', 'Sarrat'] },
      { name: 'Ilocos Sur', cities: ['Candon', 'Narvacan', 'Santa Maria', 'Tagudin', 'Vigan'] },
      { name: 'La Union', cities: ['Bauang', 'Naguilian', 'Rosario', 'San Fernando', 'San Juan'] },
      { name: 'Pangasinan', cities: ['Alaminos', 'Dagupan', 'Lingayen', 'San Carlos', 'Urdaneta'] },
    ],
  },
  {
    name: 'Region II (Cagayan Valley)',
    provinces: [
      { name: 'Batanes', cities: ['Basco', 'Itbayat', 'Ivana', 'Mahatao', 'Sabtang'] },
      { name: 'Cagayan', cities: ['Aparri', 'Baggao', 'Lal-Lo', 'Peñablanca', 'Tuguegarao'] },
      { name: 'Isabela', cities: ['Cauayan', 'Ilagan', 'Roxas', 'Santiago', 'Tumauini'] },
      {
        name: 'Nueva Vizcaya',
        cities: ['Aritao', 'Bambang', 'Bayombong', 'Dupax del Sur', 'Solano'],
      },
      { name: 'Quirino', cities: ['Aglipay', 'Cabarroguis', 'Diffun', 'Maddela', 'Saguday'] },
    ],
  },
  {
    name: 'Region III (Central Luzon)',
    provinces: [
      { name: 'Aurora', cities: ['Baler', 'Casiguran', 'Dilasag', 'Dinalungan', 'Dipaculao'] },
      { name: 'Bataan', cities: ['Abucay', 'Bagac', 'Balanga', 'Dinalupihan', 'Mariveles'] },
      {
        name: 'Bulacan',
        cities: ['Baliuag', 'Malolos', 'Meycauayan', 'San Jose del Monte', 'Santa Maria'],
      },
      { name: 'Nueva Ecija', cities: ['Cabanatuan', 'Gapan', 'Muñoz', 'Palayan', 'San Jose'] },
      { name: 'Pampanga', cities: ['Angeles', 'Apalit', 'Guagua', 'Mabalacat', 'San Fernando'] },
      { name: 'Tarlac', cities: ['Bamban', 'Camiling', 'Capas', 'Concepcion', 'Tarlac City'] },
      { name: 'Zambales', cities: ['Botolan', 'Iba', 'Olongapo', 'San Antonio', 'Subic'] },
    ],
  },
  {
    name: 'Region IV-A (CALABARZON)',
    provinces: [
      { name: 'Batangas', cities: ['Batangas City', 'Calaca', 'Lipa', 'Nasugbu', 'Tanauan'] },
      { name: 'Cavite', cities: ['Bacoor', 'Cavite City', 'Dasmariñas', 'Imus', 'Tagaytay'] },
      { name: 'Laguna', cities: ['Biñan', 'Cabugao', 'Calamba', 'Los Baños', 'Santa Rosa'] },
      { name: 'Quezon', cities: ['Atimonan', 'Candelaria', 'Lucban', 'Lucena', 'Tayabas'] },
      { name: 'Rizal', cities: ['Angono', 'Antipolo', 'Binangonan', 'Cainta', 'Taytay'] },
    ],
  },
  {
    name: 'Region IV-B (MIMAROPA)',
    provinces: [
      { name: 'Marinduque', cities: ['Boac', 'Buenavista', 'Gasan', 'Mogpog', 'Torrijos'] },
      {
        name: 'Occidental Mindoro',
        cities: ['Abra de Ilog', 'Magsaysay', 'Mamburao', 'Sablayan', 'San Jose'],
      },
      {
        name: 'Oriental Mindoro',
        cities: ['Baco', 'Bongabong', 'Calapan', 'Naujan', 'Pinamalayan'],
      },
      { name: 'Palawan', cities: ['Coron', 'El Nido', 'Narra', 'Puerto Princesa', 'Roxas'] },
      { name: 'Romblon', cities: ['Alcantara', 'Looc', 'Odiongan', 'Romblon', 'San Jose'] },
    ],
  },
  {
    name: 'Region V (Bicol Region)',
    provinces: [
      { name: 'Albay', cities: ['Camalig', 'Daraga', 'Guinobatan', 'Legazpi', 'Tabaco'] },
      { name: 'Camarines Norte', cities: ['Basud', 'Daet', 'Labo', 'Mercedes', 'Vinzons'] },
      { name: 'Camarines Sur', cities: ['Baao', 'Iriga', 'Naga', 'Pili', 'Rinconada'] },
      { name: 'Catanduanes', cities: ['Bagamanoc', 'Baras', 'Caramoran', 'San Andres', 'Virac'] },
      {
        name: 'Masbate',
        cities: ['Aroroy', 'Cataingan', 'Dimasalang', 'Masbate City', 'Milagros'],
      },
      { name: 'Sorsogon', cities: ['Bacon', 'Bulan', 'Gubat', 'Irosin', 'Sorsogon City'] },
    ],
  },
  {
    name: 'Region VI (Western Visayas)',
    provinces: [
      { name: 'Aklan', cities: ['Batan', 'Buruanga', 'Ibajay', 'Kalibo', 'Malay (Boracay)'] },
      { name: 'Antique', cities: ['Hamtic', 'Pandan', 'San Jose', 'Sibalom', 'Tibiao'] },
      { name: 'Capiz', cities: ['Dumarao', 'Mambusao', 'Panay', 'Pontevedra', 'Roxas City'] },
      {
        name: 'Guimaras',
        cities: ['Buenavista', 'Jordan', 'Nueva Valencia', 'San Lorenzo', 'Sibunag'],
      },
      {
        name: 'Iloilo',
        cities: ['Barotac Nuevo', 'Iloilo City', 'Miagao', 'Oton', 'Santa Barbara'],
      },
    ],
  },
  {
    name: 'Negros Island Region (NIR)',
    provinces: [
      { name: 'Negros Occidental', cities: ['Bacolod', 'Bago', 'Cadiz', 'San Carlos', 'Silay'] },
      { name: 'Negros Oriental', cities: ['Amlan', 'Bais', 'Dumaguete', 'Sibulan', 'Tanjay'] },
      { name: 'Siquijor', cities: ['Enrique Villanueva', 'Larena', 'Lazi', 'Maria', 'Siquijor'] },
    ],
  },
  {
    name: 'Region VII (Central Visayas)',
    provinces: [
      { name: 'Bohol', cities: ['Alburquerque', 'Dauis', 'Loboc', 'Panglao', 'Tagbilaran'] },
      { name: 'Cebu', cities: ['Carcar', 'Cebu City', 'Lapu-Lapu', 'Mandaue', 'Talisay'] },
    ],
  },
  {
    name: 'Region VIII (Eastern Visayas)',
    provinces: [
      { name: 'Biliran', cities: ['Almeria', 'Biliran', 'Cabucgayan', 'Caibiran', 'Naval'] },
      { name: 'Eastern Samar', cities: ['Balangkayan', 'Borongan', 'Dolores', 'Guiuan', 'Oras'] },
      { name: 'Leyte', cities: ['Abuyog', 'Baybay', 'Ormoc', 'Palo', 'Tacloban'] },
      { name: 'Northern Samar', cities: ['Allen', 'Bobon', 'Catarman', 'Gamay', 'Laoang'] },
      { name: 'Samar', cities: ['Basey', 'Calbayog', 'Catbalogan', 'Gandara', 'Santa Rita'] },
      { name: 'Southern Leyte', cities: ['Hinunangan', 'Liloan', 'Maasin', 'Macrohon', 'Sogod'] },
    ],
  },
  {
    name: 'Region IX (Zamboanga Peninsula)',
    provinces: [
      {
        name: 'Zamboanga del Norte',
        cities: ['Dapitan', 'Dipolog', 'Liloy', 'Sindangan', 'Siocon'],
      },
      {
        name: 'Zamboanga del Sur',
        cities: ['Aurora', 'Pagadian', 'Tukuran', 'Vincenzo Sagun', 'Zamboanga City'],
      },
      { name: 'Zamboanga Sibugay', cities: ['Alicia', 'Buug', 'Ipil', 'Mabuhay', 'Tungawan'] },
      { name: 'Sulu', cities: ['Indanan', 'Jolo', 'Luuk', 'Panamao', 'Patikul'] },
    ],
  },
  {
    name: 'Region X (Northern Mindanao)',
    provinces: [
      { name: 'Bukidnon', cities: ['Don Carlos', 'Malaybalay', 'Maramag', 'Quezon', 'Valencia'] },
      { name: 'Camiguin', cities: ['Catarman', 'Guinsiliban', 'Mahinog', 'Mambajao', 'Sagay'] },
      {
        name: 'Lanao del Norte',
        cities: ['Iligan', 'Kauswagan', 'Kolambugan', 'Linamon', 'Tubod'],
      },
      {
        name: 'Misamis Occidental',
        cities: ['Aloran', 'Jimenez', 'Oroquieta', 'Ozamiz', 'Tangub'],
      },
      {
        name: 'Misamis Oriental',
        cities: ['Cagayan de Oro', 'El Salvador', 'Gingoog', 'Jasaan', 'Villanueva'],
      },
    ],
  },
  {
    name: 'Region XI (Davao Region)',
    provinces: [
      {
        name: 'Davao de Oro',
        cities: ['Compostela', 'Mabini', 'Monkayo', 'Nabunturan', 'Pantukan'],
      },
      { name: 'Davao del Norte', cities: ['Carmen', 'Panabo', 'Samal', 'Santo Tomas', 'Tagum'] },
      {
        name: 'Davao del Sur',
        cities: ['Davao City', 'Digos', 'Hagonoy', 'Malalag', 'Santa Cruz'],
      },
      {
        name: 'Davao Occidental',
        cities: ['Don Marcelino', 'Jose Abad Santos', 'Malita', 'Santa Maria', 'Sarangani'],
      },
      { name: 'Davao Oriental', cities: ['Baganga', 'Cateel', 'Lupon', 'Mati', 'San Isidro'] },
    ],
  },
  {
    name: 'Region XII (SOCCSKSARGEN)',
    provinces: [
      { name: 'Cotabato', cities: ['Carmen', 'Kidapawan', 'Makilala', 'Midsayap', 'Pikit'] },
      { name: 'Sarangani', cities: ['Alabel', 'Glan', 'Kiamba', 'Maasim', 'Malapatan'] },
      {
        name: 'South Cotabato',
        cities: ['General Santos (Dadiangas)', 'Koronadal', 'Polomolok', 'Surallah', 'Tupi'],
      },
      { name: 'Sultan Kudarat', cities: ['Bagumbayan', 'Isulan', 'Lebak', 'Lutayan', 'Tacurong'] },
    ],
  },
  {
    name: 'Region XIII (Caraga)',
    provinces: [
      {
        name: 'Agusan del Norte',
        cities: ['Buenavista', 'Butuan', 'Cabadbaran', 'Jabonga', 'Tubay'],
      },
      {
        name: 'Agusan del Sur',
        cities: ['Bayugan', 'Bunawan', 'Prosperidad', 'San Francisco', 'Trento'],
      },
      {
        name: 'Dinagat Islands',
        cities: ['Basilisa', 'Cagdianao', 'Dinagat', 'Loreto', 'San Jose'],
      },
      {
        name: 'Surigao del Norte',
        cities: ['Claver', 'Dapa', 'General Luna', 'Placer', 'Surigao City'],
      },
      { name: 'Surigao del Sur', cities: ['Barobo', 'Bislig', 'Cantilan', 'Lianga', 'Tandag'] },
    ],
  },
  {
    name: 'Bangsamoro Autonomous Region in Muslim Mindanao (BARMM)',
    provinces: [
      { name: 'Basilan', cities: ['Akbar', 'Isabela City', 'Lamitan', 'Maluso', 'Sumisip'] },
      { name: 'Lanao del Sur', cities: ['Balindong', 'Malabang', 'Marawi', 'Tugaya', 'Wao'] },
      {
        name: 'Maguindanao del Norte',
        cities: ['Barira', 'Buldon', 'Cotabato City', 'Parang', 'Sultan Kudarat'],
      },
      {
        name: 'Maguindanao del Sur',
        cities: ['Ampatuan', 'Datu Paglas', 'Datu Piang', 'Mamasapano', 'Shariff Aguak'],
      },
      {
        name: 'Tawi-Tawi',
        cities: ['Bongao', 'Mapun', 'Panglima Sugala', 'Sitangkai', 'Turtle Islands'],
      },
    ],
  },
]

export function getAllRegions(): string[] {
  return philippineRegions.map((r) => r.name)
}

export function getProvincesByRegion(regionName: string): string[] {
  const region = philippineRegions.find((r) => r.name === regionName)
  return region?.provinces.map((p) => p.name) ?? []
}

export function getCitiesByProvince(regionName: string, provinceName: string): string[] {
  const region = philippineRegions.find((r) => r.name === regionName)
  const province = region?.provinces.find((p) => p.name === provinceName)
  return province?.cities ?? []
}
