# Crew

The public Hall Crew layer. It defines roles, automata, roster assembly,
dispatch, monitoring, and the Pi tools such as `start_crew`.

It may use the crew host (`runner/`), but never directly owns VMs, Nix closures, guest
suite implementations, or credentials.
