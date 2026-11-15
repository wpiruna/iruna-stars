/** Team shield: the user's image on a white disc, or one drawn with code from the team ID. */
import { imageUrl, shieldPlaceholder } from '../../data/images';

export function Shield({ id, code, image, size = 4 }: { id: string; code: string; image?: string; size?: number }) {
  const url = imageUrl(image);
  const style = { width: `${size}rem`, height: `${size}rem` };
  return url ? (
    <span class="shield shield--image" style={style}>
      <img src={url} alt="" draggable={false} />
    </span>
  ) : (
    <span class="shield" style={style}>
      <img src={shieldPlaceholder(id, code)} alt="" draggable={false} />
    </span>
  );
}
