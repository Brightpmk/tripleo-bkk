export type SizeChartStyle = "boxy" | "womens-boxy";

export type SizeChartImage = {
  src: string;
  alt: string;
  collection: string;
};

export type SizeChartGroup = {
  id: SizeChartStyle;
  label: string;
  sizeRange: string;
  images: SizeChartImage[];
};

export const sizeChartGroups: SizeChartGroup[] = [
  {
    id: "boxy",
    label: "Boxy Tee",
    sizeRange: "XS-5XL",
    images: [
      {
        src: "/size-charts/IMG_7806.JPG",
        alt: "Boxy Tee size chart, Bangmod collection",
        collection: "Bangmod"
      },
      {
        src: "/size-charts/IMG_7810.JPG",
        alt: "Boxy Tee size chart, North Bangkok collection",
        collection: "North Bangkok"
      },
      {
        src: "/size-charts/IMG_7811.JPG",
        alt: "Boxy Tee size chart, Ladkrabang collection",
        collection: "Ladkrabang"
      }
    ]
  },
  {
    id: "womens-boxy",
    label: "Women's Boxy Tee",
    sizeRange: "XS-3XL",
    images: [
      {
        src: "/size-charts/IMG_7807.JPG",
        alt: "Women's Boxy Tee size chart, Bangmod collection",
        collection: "Bangmod"
      },
      {
        src: "/size-charts/IMG_7808.JPG",
        alt: "Women's Boxy Tee size chart, North Bangkok collection",
        collection: "North Bangkok"
      },
      {
        src: "/size-charts/IMG_7809.JPG",
        alt: "Women's Boxy Tee size chart, Ladkrabang collection",
        collection: "Ladkrabang"
      }
    ]
  }
];
