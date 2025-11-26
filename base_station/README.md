# Base Station GUI

## Environment Setup
* Install UV: https://docs.astral.sh/uv/getting-started/installation/
* Install Labjack's library: https://support.labjack.com/docs/ljm-software-installer-downloads-t4-t7-t8-digit
* Run `uv sync` to install all the necessary python dependencies

## Running the App
* Option 1: Run `uv run main.py` in a terminal from the `base_station` folder.
* Option 2:  `Base Station.command` (macOS) or `Base Station.bat` (Windows) to launch via `uv` using the local `.venv` and correct import paths. 
If macOS blocks it the first time, run `chmod +x "Base Station.command"` and try again.
