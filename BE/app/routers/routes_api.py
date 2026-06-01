"""Routes API proxy — frontend never sees the server key."""
from fastapi import APIRouter, Depends

from app.routers.dependencies import get_current_user_optional
from app.schemas.route_schema import RouteRequest, RouteResponse
from app.services.google_maps_service import compute_route

router = APIRouter(prefix="/api", tags=["maps"])


@router.post("/routes", response_model=RouteResponse)
async def compute_routes_endpoint(
    payload: RouteRequest,
    _user=Depends(get_current_user_optional),   # public OK; rate-limit easier when logged in
):
    """Compute a single route through origin → waypoints → destination."""
    result = await compute_route(
        origin=payload.origin,
        destination=payload.destination,
        waypoints=payload.waypoints,
        travel_mode=payload.travel_mode,
        language=payload.language,
        region=payload.region,
    )
    return RouteResponse(
        distance_meters=result["distance_meters"],
        duration_seconds=result["duration_seconds"],
        encoded_polyline=result["encoded_polyline"],
        travel_mode=payload.travel_mode,
        summary=result.get("summary"),
    )
