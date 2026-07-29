import type { ColorScheme } from '../theme/systemColorScheme';

export interface MapTheme {
  basemapStyle: string;
  background: string;
  ink: string;
  mutedContext: string;
  paper: string;
  labelHalo: string;
  selection: string;
  hover: string;
  gesturePreview: string;
  handle: string;
  neutralFacility: string;
  footprint: string;
  footprintStroke: string;
  platform: string;
  platformStroke: string;
  roadSurface: string;
  laneMarking: string;
  centerLine: string;
  landmark: string;
  danger: string;
  vehicleStroke: string;
  routeCasing: string;
}

export const MAP_THEMES: Record<ColorScheme, MapTheme> = {
  light: {
    basemapStyle: 'https://tiles.openfreemap.org/styles/positron',
    background: '#f7f4ec',
    ink: '#191a17',
    mutedContext: '#9a9a92',
    paper: '#ffffff',
    labelHalo: '#ffffff',
    selection: '#191a17',
    hover: '#191a17',
    gesturePreview: '#191a17',
    handle: '#191a17',
    neutralFacility: '#5b5c57',
    footprint: '#191a17',
    footprintStroke: '#9a9a92',
    platform: '#191a17',
    platformStroke: '#5b5c57',
    roadSurface: '#7d8188',
    laneMarking: '#f4f2ec',
    centerLine: '#d9a62e',
    landmark: '#9a9a92',
    danger: '#b23b2e',
    vehicleStroke: '#191a17',
    routeCasing: '#191a17',
  },
  dark: {
    basemapStyle: 'https://tiles.openfreemap.org/styles/dark',
    background: '#0c0c0c',
    ink: '#e6e6df',
    mutedContext: '#92938c',
    paper: '#1e201e',
    labelHalo: '#111310',
    selection: '#e6e6df',
    hover: '#c6c7c0',
    gesturePreview: '#e6e6df',
    handle: '#e6e6df',
    neutralFacility: '#c6c7c0',
    footprint: '#e6e6df',
    footprintStroke: '#92938c',
    platform: '#e6e6df',
    platformStroke: '#c6c7c0',
    roadSurface: '#4f5358',
    laneMarking: '#e6e6df',
    centerLine: '#e9bd57',
    landmark: '#92938c',
    danger: '#ffb4ab',
    vehicleStroke: '#e6e6df',
    routeCasing: '#e6e6df',
  },
};
