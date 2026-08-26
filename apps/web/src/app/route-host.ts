import type { ComponentType } from 'react';
import type { RouteIntent } from './route-intent';

export interface RouteHostProps {
  routeIntent: RouteIntent;
}

export type RouteHostLoader = () => Promise<{ default: ComponentType<RouteHostProps> }>;
