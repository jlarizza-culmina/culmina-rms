-- Track last-modified time on ingredient_library, maintained by a BEFORE UPDATE trigger.
ALTER TABLE public.ingredient_library
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ingredient_library_updated_at ON public.ingredient_library;
CREATE TRIGGER ingredient_library_updated_at
  BEFORE UPDATE ON public.ingredient_library
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
